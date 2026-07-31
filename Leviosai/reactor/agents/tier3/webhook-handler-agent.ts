// ─── WEBHOOK HANDLER AGENT ──────────────────────────────────────────────────
// Processes inbound webhook events and translates them into Reactor events.

import { BaseAgent } from "../base-agent.js";
import type { ReactorEvent, AgentResult, AgentContext } from "../../types.js";

export class WebhookHandlerAgent extends BaseAgent {
  id = "webhook-handler";
  name = "Webhook & Inbound Handler";
  tier = 3 as const;
  priority = 2;
  isBlocking = false;
  timeout = 10_000;

  canHandle(event: ReactorEvent): boolean {
    return event.type.startsWith("webhook.");
  }

  protected async _execute(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    switch (event.type) {
      case "webhook.twilio.sms":
        return this.handleInboundSms(event, context);
      case "webhook.twilio.call_status":
        return this.handleCallStatus(event, context);
      case "webhook.stripe.payment":
        return this.handleStripePayment(event, context);
      default:
        return this.ok({ handled: false, reason: "unknown_webhook_type" });
    }
  }

  private async handleInboundSms(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    const { from, body } = event.payload;

    // Match to lead by phone
    const lead = await context.storage.getLeadByPhone(from);
    if (!lead) {
      context.log("info", `Inbound SMS from unknown number: ${from}`);
      return this.ok({ matched: false, from });
    }

    // Store message
    await context.storage.createLeadMessage({
      leadId: lead.id,
      channel: "sms",
      content: body,
      status: "delivered",
      direction: "inbound",
      aiGenerated: false,
    });

    // Emit for sentiment analysis
    context.emit({
      type: "message.inbound",
      organizationId: lead.organizationId || event.organizationId,
      payload: { leadId: lead.id, content: body, channel: "sms", from },
      metadata: { leadId: lead.id, priority: 2, agentSource: this.id },
    });

    return this.ok({ matched: true, leadId: lead.id });
  }

  private async handleCallStatus(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    const { callSid, callStatus, to } = event.payload;
    context.log("info", `Call ${callSid} → ${callStatus}`);

    const lead = await context.storage.getLeadByPhone(to);
    if (lead) {
      await context.storage.logActivity({
        entityType: "lead",
        entityId: lead.id,
        action: "call_status",
        details: `Call ${callSid}: ${callStatus}`,
        organizationId: lead.organizationId,
      });
    }

    return this.ok({ callSid, callStatus, leadId: lead?.id });
  }

  private async handleStripePayment(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    context.log("info", "Stripe payment webhook received");
    return this.ok({ handled: true });
  }
}
