// ─── SMS AGENT ──────────────────────────────────────────────────────────────
// Agent 2: Multi-step SMS outreach with AI-generated, step-specific messages.
// Provider chain: Twilio (send) → Claude (message gen)
// Ported from Python SMSAgent with 3-step sequence.

import { BaseAgent } from "../base-agent.js";
import { sendSMS, isTwilioConfigured } from "../../../lib/twilio.js";
import { generateMessage } from "../../../lib/ai.js";
import { MAX_SMS_PER_DAY, OUTREACH_COSTS } from "../../config.js";
import type { ReactorEvent, AgentResult, AgentContext } from "../../types.js";

// Step-specific prompt guidance (from Python agent_system.py)
const STEP_PROMPTS: Record<number, string> = {
  1: `First contact SMS. Be warm and casual. Mention their name and that they previously showed interest.
Keep it under 160 chars. Include a soft CTA like "Would love to chat when you have a sec."
Do NOT be salesy. Sound like a real person texting.`,

  2: `Follow-up SMS (they didn't respond to the first). Reference that you reached out before.
Add a small value prop or social proof. Keep it conversational and under 160 chars.
Example tone: "Hey {name}, just circling back — we helped 3 homeowners on your street last month."`,

  3: `Final SMS in the sequence. Create gentle urgency without being pushy.
Mention this is the last follow-up. Offer an easy opt-out.
Example tone: "Last note from us — if timing isn't right, no worries at all. Just reply STOP."`,
};

export class SmsAgent extends BaseAgent {
  id = "sms-agent";
  name = "SMS Agent";
  tier = 1 as const;
  priority = 0;
  isBlocking = false;
  timeout = 30_000;

  private costPerSms = OUTREACH_COSTS.sms;

  canHandle(event: ReactorEvent): boolean {
    return event.type === "outreach.sms.send";
  }

  protected async _execute(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    const leadId = event.metadata.leadId || event.payload.leadId;
    if (!leadId) return this.fail("No leadId");

    const lead = await context.storage.getLead(leadId);
    if (!lead) return this.fail("Lead not found");
    if (!lead.phone) return this.fail("Lead has no phone number");

    // Determine sequence step (1-3)
    const step = Math.min(event.payload.step || this.getNextStep(lead), 3);

    // Check daily SMS limit (TCPA: max 1 SMS per day per lead)
    if (await this.hitDailyLimit(leadId, context)) {
      return this.ok({ sent: false, reason: "daily_sms_limit", step });
    }

    // Generate step-specific message via AI (or use provided message)
    let messageText = event.payload.message;
    if (!messageText) {
      const stepPrompt = STEP_PROMPTS[step] || STEP_PROMPTS[1];
      const generated = await generateMessage(
        {
          firstName: lead.firstName,
          lastName: lead.lastName,
          source: lead.source,
          status: lead.status,
          additionalContext: `${stepPrompt}\n\nThis is step ${step} of 3 in the SMS sequence.`,
        },
        "sms"
      );
      messageText = generated.message;
    }

    // Truncate to SMS-safe length (160 chars for single segment)
    if (messageText.length > 160) {
      messageText = messageText.substring(0, 157) + "...";
    }

    // Send via Twilio
    if (!isTwilioConfigured()) {
      await context.storage.createLeadMessage({
        leadId,
        channel: "sms",
        content: messageText,
        status: "pending",
        direction: "outbound",
        aiGenerated: true,
      });
      return this.ok({ sent: false, reason: "twilio_not_configured", message: messageText, step });
    }

    const result = await sendSMS(lead.phone, messageText);

    // Store message
    await context.storage.createLeadMessage({
      leadId,
      channel: "sms",
      content: messageText,
      status: result.success ? "sent" : "failed",
      direction: "outbound",
      aiGenerated: !event.payload.message,
    });

    // Increment outreach attempts
    await context.storage.updateLead(leadId, {
      outreachAttempts: ((lead as any).outreachAttempts || 0) + 1,
      lastContactedAt: new Date(),
    } as any);

    // Emit result
    context.emit({
      type: "outreach.result",
      organizationId: event.organizationId,
      payload: {
        leadId,
        channel: "sms",
        success: result.success,
        sid: result.sid,
        error: result.error,
        step,
      },
      metadata: { leadId, priority: 4, agentSource: this.id },
    });

    // If this wasn't the last step and it was successful, schedule next step
    if (result.success && step < 3) {
      const nextDelayHours = step === 1 ? 48 : 72; // 2 days after step 1, 3 days after step 2
      context.emit({
        type: "outreach.sms.send",
        organizationId: event.organizationId,
        payload: { leadId, step: step + 1, scheduledDelayMs: nextDelayHours * 3600 * 1000 },
        metadata: { leadId, priority: 5, agentSource: this.id },
      });
    }

    return this.ok(
      { sent: result.success, sid: result.sid, step, message: messageText.substring(0, 50) },
      { costCents: this.costPerSms }
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private getNextStep(lead: any): number {
    const attempts = (lead as any).outreachAttempts || 0;
    // If they've had 0 SMS, this is step 1. 1 SMS = step 2. 2+ = step 3.
    return Math.min(attempts + 1, 3);
  }

  private async hitDailyLimit(leadId: number, context: AgentContext): Promise<boolean> {
    // Check how many SMS were sent to this lead today
    // Uses activity log as proxy — a proper implementation would query lead_messages by date
    try {
      const todayMessages = await context.storage.getLeadMessages(leadId);
      const today = new Date().toISOString().split("T")[0];
      const todaySmsCount = (todayMessages || []).filter((m: any) =>
        m.channel === "sms" &&
        m.direction === "outbound" &&
        m.createdAt?.toISOString?.()?.startsWith(today)
      ).length;
      return todaySmsCount >= MAX_SMS_PER_DAY;
    } catch {
      return false; // If we can't check, allow it
    }
  }
}
