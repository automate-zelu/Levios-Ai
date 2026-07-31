// ─── LEAD SCORING AGENT ─────────────────────────────────────────────────────
// Agent 6: Signal-based scoring with time decay and threshold triggers.
// Combines AI scoring (lib/ai.ts) with Python's signal weight system.
// Score: 0-100. Warm ≥ 70. Dead ≤ 10. Decay: -2 pts/day of inactivity.

import { BaseAgent } from "../base-agent.js";
import { scoreLead } from "../../../lib/ai.js";
import {
  SIGNAL_WEIGHTS,
  SCORE_DECAY_RATE,
  SCORE_WARM_THRESHOLD,
  SCORE_DEAD_THRESHOLD,
} from "../../config.js";
import type { ReactorEvent, AgentResult, AgentContext } from "../../types.js";

export class LeadScoringAgent extends BaseAgent {
  id = "lead-scoring";
  name = "Lead Scoring Agent";
  tier = 2 as const;
  priority = 0;
  isBlocking = false;
  timeout = 30_000;

  canHandle(event: ReactorEvent): boolean {
    return [
      "lead.created",
      "lead.imported",
      "scoring.requested",
      "scoring.signal",
      "lead.updated",
    ].includes(event.type);
  }

  protected async _execute(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    const leadId = event.metadata.leadId || event.payload.leadId;
    if (!leadId) return this.fail("No leadId provided");

    const lead = await context.storage.getLead(leadId);
    if (!lead) return this.fail("Lead not found");

    // If this is a signal event, apply signal weight and skip full AI scoring
    if (event.type === "scoring.signal") {
      return this.applySignal(event, lead, context);
    }

    // Full AI scoring for new leads or explicit requests
    return this.fullScore(event, lead, leadId, context);
  }

  // ─── Signal-based scoring (fast, no AI call) ──────────────────────────

  private async applySignal(event: ReactorEvent, lead: any, context: AgentContext): Promise<AgentResult> {
    const { signal, value } = event.payload;
    const leadId = lead.id;

    // Get weight from config or use provided value
    const weight = SIGNAL_WEIGHTS[signal] ?? value ?? 0;
    const currentScore = lead.aiScore || 50; // Default starting score

    // Apply time decay: -2 points per day since last contact
    const decayPenalty = this.calculateDecay(lead);
    const rawScore = currentScore + weight - decayPenalty;

    // Clamp to 0-100
    const newScore = Math.max(0, Math.min(100, rawScore));
    const temperature = this.scoreToTemperature(newScore);

    await context.storage.updateLead(leadId, {
      aiScore: newScore,
      aiTemperature: temperature,
      sentimentScore: lead.sentimentScore || newScore,
    } as any);

    context.log("info", `Lead ${leadId} signal ${signal}: ${currentScore} → ${newScore} (${temperature})`);

    // Check thresholds and emit routing events
    const emitEvents = this.checkThresholds(event, leadId, newScore, temperature, currentScore);

    return this.ok(
      { score: newScore, temperature, signal, weight, decayPenalty, previousScore: currentScore },
      {
        costCents: 0,
        emitEvents,
      }
    );
  }

  // ─── Full AI scoring (slower, uses Claude) ────────────────────────────

  private async fullScore(
    event: ReactorEvent,
    lead: any,
    leadId: number,
    context: AgentContext
  ): Promise<AgentResult> {
    context.log("info", `Scoring lead ${leadId}: ${lead.firstName} ${lead.lastName}`);

    // Apply time decay before scoring
    const decayPenalty = this.calculateDecay(lead);

    const result = await scoreLead({
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email,
      phone: lead.phone,
      source: lead.source,
      status: lead.status,
      lastContactedAt: lead.lastContactedAt,
    });

    // Apply decay to AI score
    const adjustedScore = Math.max(0, Math.min(100, result.score - decayPenalty));
    const temperature = this.scoreToTemperature(adjustedScore);

    await context.storage.updateLead(leadId, {
      aiScore: adjustedScore,
      aiTemperature: temperature,
      aiObjection: result.objection,
      sentimentScore: adjustedScore,
    } as any);

    context.log("info", `Lead ${leadId} scored: ${adjustedScore} (${temperature})${decayPenalty > 0 ? ` [decay: -${decayPenalty}]` : ""}`);

    const emitEvents = this.checkThresholds(event, leadId, adjustedScore, temperature, lead.aiScore || 0);

    // Always emit scoring.complete for routing
    emitEvents.push({
      type: "scoring.complete",
      organizationId: event.organizationId,
      payload: {
        leadId,
        score: adjustedScore,
        temperature,
        objection: result.objection,
        reasoning: result.reasoning,
      },
      metadata: { leadId, priority: 3, agentSource: this.id },
    });

    return this.ok(
      { score: adjustedScore, temperature, reasoning: result.reasoning, decayPenalty },
      { costCents: 0, emitEvents }
    );
  }

  // ─── Time Decay ───────────────────────────────────────────────────────

  private calculateDecay(lead: any): number {
    if (!lead.lastContactedAt) return 0;

    const lastContact = new Date(lead.lastContactedAt).getTime();
    const now = Date.now();
    const daysSinceContact = Math.floor((now - lastContact) / (24 * 3600 * 1000));

    if (daysSinceContact <= 1) return 0; // No decay in first 24h

    return Math.min(daysSinceContact * SCORE_DECAY_RATE, 40); // Cap decay at 40 points
  }

  // ─── Score → Temperature ──────────────────────────────────────────────

  private scoreToTemperature(score: number): string {
    if (score >= SCORE_WARM_THRESHOLD) return "hot";
    if (score >= 40) return "warm";
    if (score > SCORE_DEAD_THRESHOLD) return "cold";
    return "dead";
  }

  // ─── Threshold Triggers ───────────────────────────────────────────────

  private checkThresholds(
    event: ReactorEvent,
    leadId: number,
    newScore: number,
    newTemp: string,
    previousScore: number
  ): any[] {
    const events: any[] = [];
    const previousTemp = this.scoreToTemperature(previousScore);

    // Crossed warm threshold upward → route for immediate outreach
    if (newScore >= SCORE_WARM_THRESHOLD && previousScore < SCORE_WARM_THRESHOLD) {
      events.push({
        type: "routing.evaluate",
        organizationId: event.organizationId,
        payload: { leadId, trigger: "score_warm_threshold", score: newScore, temperature: newTemp },
        metadata: { leadId, priority: 2, agentSource: this.id },
      });
    }

    // Crossed dead threshold downward → mark as dead
    if (newScore <= SCORE_DEAD_THRESHOLD && previousScore > SCORE_DEAD_THRESHOLD) {
      events.push({
        type: "lead.score_dead",
        organizationId: event.organizationId,
        payload: { leadId, score: newScore },
        metadata: { leadId, priority: 5, agentSource: this.id },
      });
    }

    // Temperature changed → routing should re-evaluate
    if (newTemp !== previousTemp && newTemp !== "dead") {
      events.push({
        type: "routing.evaluate",
        organizationId: event.organizationId,
        payload: { leadId, trigger: "temperature_change", from: previousTemp, to: newTemp },
        metadata: { leadId, priority: 4, agentSource: this.id },
      });
    }

    return events;
  }
}
