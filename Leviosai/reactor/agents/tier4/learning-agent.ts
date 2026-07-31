// ─── LEARNING & OPTIMIZATION AGENT ──────────────────────────────────────────
// Collects outcome data and computes channel/time-of-day performance stats.
// Feeds routing decisions with empirical data on what converts best.
// Future: A/B message variant testing, per-industry optimization.

import { BaseAgent } from "../base-agent.js";
import type { ReactorEvent, AgentResult, AgentContext } from "../../types.js";

// ─── IN-MEMORY LEARNING STORE ───────────────────────────────────────────────
// Per-org performance data. Survives for session lifetime.
// Future: persist to DB table for cross-restart learning.

interface ChannelStats {
  attempts: number;
  successes: number;
  appointments: number;
  totalCostCents: number;
}

interface HourStats {
  attempts: number;
  responses: number;
}

interface OrgLearningData {
  // Channel performance
  channels: Record<string, ChannelStats>;
  // Hour-of-day response rates (0-23)
  hourly: Record<number, HourStats>;
  // Industry-specific conversion (if known)
  industryConversions: Record<string, { attempts: number; appointments: number }>;
  // Sequence step performance
  sequenceSteps: Record<string, Record<number, { sent: number; responded: number }>>;
  // Last updated
  updatedAt: Date;
}

// In-memory store keyed by orgId
const learningStore = new Map<number, OrgLearningData>();

function getOrCreate(orgId: number): OrgLearningData {
  let data = learningStore.get(orgId);
  if (!data) {
    data = {
      channels: {},
      hourly: {},
      industryConversions: {},
      sequenceSteps: {},
      updatedAt: new Date(),
    };
    learningStore.set(orgId, data);
  }
  return data;
}

export class LearningAgent extends BaseAgent {
  id = "learning";
  name = "Learning & Optimization";
  tier = 4 as const;
  priority = 0;
  isBlocking = false;
  timeout = 10_000;

  canHandle(event: ReactorEvent): boolean {
    return [
      "outreach.result",
      "deal.closed",
      "appointment.confirmed",
      "reply.received",
      "scoring.complete",
      "learning.get_insights",
    ].includes(event.type);
  }

  protected async _execute(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    const orgId = event.organizationId;
    const data = getOrCreate(orgId);

    switch (event.type) {
      case "outreach.result":
        return this.recordOutreach(event, data, context);
      case "reply.received":
        return this.recordReply(event, data, context);
      case "appointment.confirmed":
        return this.recordAppointment(event, data, context);
      case "deal.closed":
        return this.recordDeal(event, data, context);
      case "scoring.complete":
        return this.recordScoring(event, data, context);
      case "learning.get_insights":
        return this.getInsights(event, data, context);
      default:
        return this.ok({ recorded: true, eventType: event.type });
    }
  }

  // ─── OUTREACH RESULT ──────────────────────────────────────────────

  private recordOutreach(event: ReactorEvent, data: OrgLearningData, context: AgentContext): AgentResult {
    const { channel, success, step, costCents } = event.payload;
    if (!channel) return this.ok({ recorded: false, reason: "no_channel" });

    // Channel stats
    if (!data.channels[channel]) {
      data.channels[channel] = { attempts: 0, successes: 0, appointments: 0, totalCostCents: 0 };
    }
    data.channels[channel].attempts++;
    if (success) data.channels[channel].successes++;
    if (costCents) data.channels[channel].totalCostCents += costCents;

    // Hour-of-day tracking
    const hour = new Date().getHours();
    if (!data.hourly[hour]) data.hourly[hour] = { attempts: 0, responses: 0 };
    data.hourly[hour].attempts++;

    // Sequence step tracking
    if (step && channel) {
      if (!data.sequenceSteps[channel]) data.sequenceSteps[channel] = {};
      if (!data.sequenceSteps[channel][step]) data.sequenceSteps[channel][step] = { sent: 0, responded: 0 };
      data.sequenceSteps[channel][step].sent++;
    }

    data.updatedAt = new Date();
    context.log("info", `Learning: recorded ${channel} outreach (success=${success}, hour=${hour})`);
    return this.ok({ recorded: true, channel, hour });
  }

  // ─── REPLY RECEIVED ───────────────────────────────────────────────

  private recordReply(event: ReactorEvent, data: OrgLearningData, context: AgentContext): AgentResult {
    const { channel, step } = event.payload;
    const hour = new Date().getHours();

    // Hour-of-day response tracking
    if (!data.hourly[hour]) data.hourly[hour] = { attempts: 0, responses: 0 };
    data.hourly[hour].responses++;

    // Sequence step response tracking
    if (step && channel && data.sequenceSteps[channel]?.[step]) {
      data.sequenceSteps[channel][step].responded++;
    }

    data.updatedAt = new Date();
    context.log("info", `Learning: recorded reply (channel=${channel}, hour=${hour})`);
    return this.ok({ recorded: true, type: "reply", hour });
  }

  // ─── APPOINTMENT CONFIRMED ────────────────────────────────────────

  private async recordAppointment(event: ReactorEvent, data: OrgLearningData, context: AgentContext): Promise<AgentResult> {
    const { channel, leadId } = event.payload;

    // Credit the channel that got the appointment
    if (channel && data.channels[channel]) {
      data.channels[channel].appointments++;
    }

    // Try to get industry from org
    try {
      if (leadId) {
        const lead = await context.storage.getLead(leadId);
        if (lead?.organizationId) {
          // Look up org industry from lead's custom fields or org settings
          const industry = (lead as any).customFields
            ? JSON.parse((lead as any).customFields)?.industry
            : null;
          if (industry) {
            if (!data.industryConversions[industry]) {
              data.industryConversions[industry] = { attempts: 0, appointments: 0 };
            }
            data.industryConversions[industry].appointments++;
          }
        }
      }
    } catch {
      // Non-critical, continue
    }

    data.updatedAt = new Date();

    // Log for dashboard visibility
    await context.storage.logActivity({
      organizationId: event.organizationId,
      entityType: "learning",
      entityId: leadId || 0,
      action: "appointment_recorded",
      details: JSON.stringify({ channel, timestamp: new Date().toISOString() }),
    });

    context.log("info", `Learning: appointment recorded (channel=${channel})`);
    return this.ok({ recorded: true, type: "appointment", channel });
  }

  // ─── DEAL CLOSED ──────────────────────────────────────────────────

  private recordDeal(event: ReactorEvent, data: OrgLearningData, context: AgentContext): AgentResult {
    const { industry } = event.payload;
    if (industry) {
      if (!data.industryConversions[industry]) {
        data.industryConversions[industry] = { attempts: 0, appointments: 0 };
      }
      // Deal closed counts as an appointment conversion for tracking
      data.industryConversions[industry].appointments++;
    }

    data.updatedAt = new Date();
    context.log("info", `Learning: deal closed recorded`);
    return this.ok({ recorded: true, type: "deal" });
  }

  // ─── SCORING COMPLETE ─────────────────────────────────────────────

  private recordScoring(event: ReactorEvent, data: OrgLearningData, context: AgentContext): AgentResult {
    // Track industry from scored leads for conversion rate calculation
    const { industry } = event.payload;
    if (industry) {
      if (!data.industryConversions[industry]) {
        data.industryConversions[industry] = { attempts: 0, appointments: 0 };
      }
      data.industryConversions[industry].attempts++;
    }

    data.updatedAt = new Date();
    return this.ok({ recorded: true, type: "scoring" });
  }

  // ─── GET INSIGHTS ─────────────────────────────────────────────────
  // Returns computed insights for the routing agent or dashboard.

  private getInsights(_event: ReactorEvent, data: OrgLearningData, context: AgentContext): AgentResult {
    // Best performing channel
    const channelRanking = Object.entries(data.channels)
      .map(([ch, stats]) => ({
        channel: ch,
        successRate: stats.attempts > 0 ? stats.successes / stats.attempts : 0,
        appointmentRate: stats.attempts > 0 ? stats.appointments / stats.attempts : 0,
        costPerAppointment: stats.appointments > 0 ? Math.round(stats.totalCostCents / stats.appointments) : null,
        attempts: stats.attempts,
      }))
      .sort((a, b) => b.appointmentRate - a.appointmentRate);

    // Best hours to reach out (by response rate)
    const hourlyInsights = Object.entries(data.hourly)
      .map(([h, stats]) => ({
        hour: parseInt(h),
        responseRate: stats.attempts > 0 ? stats.responses / stats.attempts : 0,
        attempts: stats.attempts,
        responses: stats.responses,
      }))
      .filter((h) => h.attempts >= 3) // need minimum sample
      .sort((a, b) => b.responseRate - a.responseRate);

    const bestHours = hourlyInsights.slice(0, 3).map((h) => h.hour);

    // Sequence step performance
    const stepInsights: Record<string, Array<{ step: number; responseRate: number }>> = {};
    for (const [channel, steps] of Object.entries(data.sequenceSteps)) {
      stepInsights[channel] = Object.entries(steps)
        .map(([s, stats]) => ({
          step: parseInt(s),
          responseRate: stats.sent > 0 ? stats.responded / stats.sent : 0,
        }))
        .sort((a, b) => a.step - b.step);
    }

    context.log("info", `Learning: insights generated (${channelRanking.length} channels, ${hourlyInsights.length} hours)`);

    return this.ok({
      channelRanking,
      bestHours,
      hourlyInsights,
      stepInsights,
      industryConversions: data.industryConversions,
      dataPoints: Object.values(data.channels).reduce((sum, c) => sum + c.attempts, 0),
      lastUpdated: data.updatedAt.toISOString(),
    });
  }
}

// Export for external access (e.g., routing agent can query insights)
export function getLearningInsights(orgId: number): OrgLearningData | undefined {
  return learningStore.get(orgId);
}
