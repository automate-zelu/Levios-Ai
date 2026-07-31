// ─── ROUTING & STATE MACHINE AGENT ──────────────────────────────────────────
// Decides the next outreach channel based on lead score, temperature, and
// outreach history. Transitions leads through the pipeline.

import { BaseAgent } from "../base-agent.js";
import type { ReactorEvent, AgentResult, AgentContext, EmitEventInput } from "../../types.js";

export class RoutingAgent extends BaseAgent {
  id = "routing";
  name = "Routing & State Machine";
  tier = 3 as const;
  priority = 5; // runs after compliance + budget checks
  isBlocking = false;
  timeout = 5_000;

  canHandle(event: ReactorEvent): boolean {
    return (
      event.type === "scoring.complete" ||
      event.type === "outreach.result" ||
      event.type === "reply.received" ||
      event.type === "routing.evaluate"
    );
  }

  protected async _execute(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    const leadId = event.metadata.leadId || event.payload.leadId;
    if (!leadId) return this.fail("No leadId provided");

    const lead = await context.storage.getLead(leadId);
    if (!lead) return this.fail("Lead not found");

    const currentState = await context.getLeadState(leadId);

    switch (event.type) {
      case "scoring.complete":
        return this.routeAfterScoring(event, lead, currentState, context);

      case "outreach.result":
        return this.routeAfterOutreach(event, lead, currentState, context);

      case "reply.received":
        return this.routeAfterReply(event, lead, currentState, context);

      case "routing.evaluate":
        return this.evaluate(event, lead, currentState, context);

      default:
        return this.ok({ action: "no_routing_needed" });
    }
  }

  // After scoring, decide if this lead should enter outreach
  private async routeAfterScoring(
    event: ReactorEvent,
    lead: any,
    currentState: string | null,
    context: AgentContext
  ): Promise<AgentResult> {
    const score = event.payload.score || lead.aiScore || 0;
    const temperature = event.payload.temperature || lead.aiTemperature;

    // Only route leads that are in "validating" or "ready" state
    if (currentState !== "validating" && currentState !== "ready") {
      return this.ok({ action: "not_routable", currentState });
    }

    // Transition validating → ready first
    if (currentState === "validating") {
      await context.transitionLead(event.metadata.leadId!, "ready", "Scoring complete", this.id);
    }

    // Determine outreach channel based on score
    const channel = this.selectChannel(score, temperature, lead);

    if (!channel) {
      context.log("info", `Lead ${lead.id} scored too low for outreach (score: ${score})`);
      return this.ok({ action: "hold", reason: "score_too_low", score });
    }

    // Queue outreach
    const outreachEvent: EmitEventInput = {
      type: `outreach.${channel}.send`,
      organizationId: event.organizationId,
      payload: {
        leadId: lead.id,
        channel,
        score,
        temperature,
      },
      metadata: {
        leadId: lead.id,
        priority: temperature === "hot" ? 2 : 3,
        agentSource: this.id,
      },
    };

    return this.ok(
      { action: "outreach_queued", channel, score, temperature },
      {
        leadStateTransition: "outreach_queued",
        emitEvents: [outreachEvent],
      }
    );
  }

  // After outreach is sent, update state
  private async routeAfterOutreach(
    event: ReactorEvent,
    lead: any,
    currentState: string | null,
    context: AgentContext
  ): Promise<AgentResult> {
    const success = event.payload.success;

    if (success && currentState === "outreach_queued") {
      return this.ok(
        { action: "contacted", channel: event.payload.channel },
        { leadStateTransition: "contacted" }
      );
    }

    if (!success) {
      context.log("warn", `Outreach failed for lead ${lead.id}: ${event.payload.error}`);
      return this.ok({ action: "outreach_failed", error: event.payload.error });
    }

    return this.ok({ action: "no_change" });
  }

  // When a lead replies (inbound SMS, email reply)
  private async routeAfterReply(
    event: ReactorEvent,
    lead: any,
    currentState: string | null,
    context: AgentContext
  ): Promise<AgentResult> {
    // Any reply from a contacted lead = engaged
    if (currentState === "contacted" || currentState === "outreach_queued") {
      return this.ok(
        { action: "engaged", trigger: "reply" },
        { leadStateTransition: "engaged" }
      );
    }

    return this.ok({ action: "reply_noted", currentState });
  }

  // General evaluation (e.g., periodic re-routing)
  private async evaluate(
    event: ReactorEvent,
    lead: any,
    currentState: string | null,
    context: AgentContext
  ): Promise<AgentResult> {
    return this.ok({ action: "evaluated", currentState, score: lead.aiScore });
  }

  // ─── Channel Selection Logic ──────────────────────────────────────────

  private selectChannel(score: number, temperature: string | null, lead: any): string | null {
    // Score too low — don't outreach yet
    if (score < 20) return null;

    // Hot leads: call first
    if (temperature === "hot" && lead.phone) return "call.initiate";

    // Warm leads: SMS first
    if (temperature === "warm" && lead.phone) return "sms";

    // Cold leads or no phone: email
    if (lead.email) return "email";

    // Fallback: SMS if they have a phone
    if (lead.phone) return "sms";

    return null; // No contact method available
  }
}
