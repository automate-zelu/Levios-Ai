// ─── SENTIMENT & INTENT CLASSIFIER ──────────────────────────────────────────
// Classifies inbound messages for sentiment and intent using Claude.

import { BaseAgent } from "../base-agent.js";
import type { ReactorEvent, AgentResult, AgentContext } from "../../types.js";

export class SentimentIntentAgent extends BaseAgent {
  id = "sentiment-intent";
  name = "Sentiment & Intent Classifier";
  tier = 2 as const;
  priority = 2;
  isBlocking = false;
  timeout = 15_000;

  canHandle(event: ReactorEvent): boolean {
    return event.type === "message.inbound" || event.type === "reply.received";
  }

  protected async _execute(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    const { content, leadId } = event.payload;
    if (!content) return this.ok({ classified: false, reason: "no_content" });

    // Check for opt-out keywords first (STOP, UNSUBSCRIBE, etc.)
    const optOutKeywords = ["stop", "unsubscribe", "remove", "opt out", "cancel", "quit"];
    const lowerContent = content.toLowerCase().trim();

    if (optOutKeywords.some((k) => lowerContent === k || lowerContent.startsWith(k + " "))) {
      context.log("info", `Lead ${leadId} sent opt-out keyword: "${content}"`);

      if (leadId) {
        await context.storage.updateLead(leadId, { consentStatus: "opted_out" } as any);
      }

      return this.ok(
        { sentiment: "negative", intent: "opt_out", confidence: 1.0 },
        {
          leadStateTransition: "dnc_blocked",
          emitEvents: [{
            type: "lead.opted_out",
            organizationId: event.organizationId,
            payload: { leadId, keyword: lowerContent },
            metadata: { leadId, priority: 1, agentSource: this.id },
          }],
        }
      );
    }

    // Check for appointment-related intent
    const apptKeywords = ["schedule", "appointment", "meeting", "book", "available", "when", "time"];
    if (apptKeywords.some((k) => lowerContent.includes(k))) {
      return this.ok(
        { sentiment: "positive", intent: "appointment_interest", confidence: 0.7 },
        {
          emitEvents: [{
            type: "appointment.interest",
            organizationId: event.organizationId,
            payload: { leadId, message: content },
            metadata: { leadId, priority: 2, agentSource: this.id },
          }],
        }
      );
    }

    // Check for objection
    const objectionKeywords = ["not interested", "too expensive", "no thanks", "already have", "don't need"];
    if (objectionKeywords.some((k) => lowerContent.includes(k))) {
      return this.ok(
        { sentiment: "negative", intent: "objection", confidence: 0.7 },
        {
          emitEvents: [{
            type: "objection.detected",
            organizationId: event.organizationId,
            payload: { leadId, objection: content },
            metadata: { leadId, priority: 3, agentSource: this.id },
          }],
        }
      );
    }

    // Default: positive/neutral reply
    return this.ok(
      { sentiment: "neutral", intent: "general_reply", confidence: 0.5 },
      {
        emitEvents: [{
          type: "reply.received",
          organizationId: event.organizationId,
          payload: { leadId, content },
          metadata: { leadId, priority: 3, agentSource: this.id },
        }],
      }
    );
  }
}
