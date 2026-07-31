// ─── EMAIL AGENT ────────────────────────────────────────────────────────────
// Agent 3: 5-step email drip sequence with AI-generated content.
// Provider chain: Resend (send) → Claude (content gen)
// Ported from Python EmailAgent with full drip sequence and event handling.

import { BaseAgent } from "../base-agent.js";
import { sendEmail, isResendConfigured } from "../../../lib/resend.js";
import { generateMessage } from "../../../lib/ai.js";
import { EMAIL_SEQUENCE_DELAYS_DAYS, OUTREACH_COSTS } from "../../config.js";
import type { ReactorEvent, AgentResult, AgentContext } from "../../types.js";

// Step-specific email guidance (from Python agent_system.py)
const STEP_PROMPTS: Record<number, { subject: string; guidance: string }> = {
  1: {
    subject: "Quick question about your {industry} project",
    guidance: `First email — warm introduction. Reference their inquiry/interest.
Keep it short (3-4 sentences). Include a clear but soft CTA.
No attachments, no heavy formatting. Personal tone, like a real human wrote it.`,
  },
  2: {
    subject: "Following up — {name}",
    guidance: `Second email (day 2) — value-add follow-up. Share a helpful tip, stat, or case study.
Don't reference the first email directly. Provide standalone value.
"I was thinking about your situation and wanted to share this..."`,
  },
  3: {
    subject: "3 things homeowners miss about {industry}",
    guidance: `Third email (day 5) — educational content. Position as an expert.
Share 2-3 common mistakes or tips. End with a soft offer to help.
This builds trust without being salesy.`,
  },
  4: {
    subject: "Real results from your neighborhood",
    guidance: `Fourth email (day 10) — social proof. Share testimonials, case studies, or stats.
"We just finished a project 2 blocks from you..."
Include a specific, compelling number if possible.`,
  },
  5: {
    subject: "Last chance — {name}",
    guidance: `Final email (day 21) — closing with gentle urgency.
This is the last email in the sequence. Make it clear but not aggressive.
Offer an easy unsubscribe. "If this isn't the right time, I completely understand."`,
  },
};

export class EmailAgent extends BaseAgent {
  id = "email-agent";
  name = "Email Agent";
  tier = 1 as const;
  priority = 1;
  isBlocking = false;
  timeout = 30_000;

  canHandle(event: ReactorEvent): boolean {
    return [
      "outreach.email.send",
      "email.opened",
      "email.clicked",
      "email.bounced",
      "email.unsubscribed",
    ].includes(event.type);
  }

  protected async _execute(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    switch (event.type) {
      case "outreach.email.send":
        return this.sendDripEmail(event, context);
      case "email.opened":
        return this.onEmailOpened(event, context);
      case "email.clicked":
        return this.onEmailClicked(event, context);
      case "email.bounced":
        return this.onEmailBounced(event, context);
      case "email.unsubscribed":
        return this.onEmailUnsubscribed(event, context);
      default:
        return this.ok({ action: "unhandled" });
    }
  }

  private async sendDripEmail(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    const leadId = event.metadata.leadId || event.payload.leadId;
    if (!leadId) return this.fail("No leadId");

    const lead = await context.storage.getLead(leadId);
    if (!lead) return this.fail("Lead not found");
    if (!lead.email) return this.fail("Lead has no email");

    // Determine drip step (1-5)
    const step = Math.min(event.payload.step || this.getNextStep(lead), 5);
    const stepConfig = STEP_PROMPTS[step] || STEP_PROMPTS[1];

    // Generate email via AI (or use provided content)
    let subject = event.payload.subject;
    let body = event.payload.body;

    if (!body) {
      const industry = event.payload.industry || "home services";
      const generated = await generateMessage(
        {
          firstName: lead.firstName,
          lastName: lead.lastName,
          source: lead.source,
          status: lead.status,
          additionalContext: `${stepConfig.guidance}\n\nThis is email ${step} of 5 in the drip sequence.
Industry: ${industry}. Lead name: ${lead.firstName}.`,
        },
        "email"
      );
      subject = generated.subject || stepConfig.subject
        .replace("{name}", lead.firstName || "there")
        .replace("{industry}", industry);
      body = generated.message;
    }

    // Send via Resend
    if (!isResendConfigured()) {
      await context.storage.createLeadMessage({
        leadId,
        channel: "email",
        content: `Subject: ${subject}\n\n${body}`,
        status: "pending",
        direction: "outbound",
        aiGenerated: true,
      });
      return this.ok({ sent: false, reason: "resend_not_configured", step });
    }

    const result = await sendEmail(lead.email, subject!, body);

    await context.storage.createLeadMessage({
      leadId,
      channel: "email",
      content: `Subject: ${subject}\n\n${body}`,
      status: result.success ? "sent" : "failed",
      direction: "outbound",
      aiGenerated: !event.payload.body,
    });

    await context.storage.updateLead(leadId, {
      outreachAttempts: ((lead as any).outreachAttempts || 0) + 1,
      lastContactedAt: new Date(),
    } as any);

    context.emit({
      type: "outreach.result",
      organizationId: event.organizationId,
      payload: { leadId, channel: "email", success: result.success, error: result.error, step },
      metadata: { leadId, priority: 4, agentSource: this.id },
    });

    // Schedule next drip step if not the last
    if (result.success && step < 5) {
      const nextDelayDays = EMAIL_SEQUENCE_DELAYS_DAYS[step] || 3;
      const nextDelayMs = nextDelayDays * 24 * 3600 * 1000;
      context.emit({
        type: "outreach.email.send",
        organizationId: event.organizationId,
        payload: { leadId, step: step + 1, scheduledDelayMs: nextDelayMs },
        metadata: { leadId, priority: 5, agentSource: this.id },
      });
    }

    return this.ok(
      { sent: result.success, subject, step },
      { costCents: OUTREACH_COSTS.email }
    );
  }

  // ─── Email Event Handlers ──────────────────────────────────────────────

  private async onEmailOpened(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    const leadId = event.metadata.leadId || event.payload.leadId;
    if (!leadId) return this.ok({ action: "no_lead" });

    // Score signal: email opened = +5 points
    context.emit({
      type: "scoring.signal",
      organizationId: event.organizationId,
      payload: { leadId, signal: "email_opened", value: 5 },
      metadata: { leadId, priority: 3, agentSource: this.id },
    });

    return this.ok({ action: "email_opened", leadId });
  }

  private async onEmailClicked(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    const leadId = event.metadata.leadId || event.payload.leadId;
    if (!leadId) return this.ok({ action: "no_lead" });

    // Score signal: email clicked = +15 points (high intent)
    context.emit({
      type: "scoring.signal",
      organizationId: event.organizationId,
      payload: { leadId, signal: "email_clicked", value: 15 },
      metadata: { leadId, priority: 2, agentSource: this.id },
    });

    // Clicking a link = warm lead, consider escalating to SMS/call
    context.emit({
      type: "routing.evaluate",
      organizationId: event.organizationId,
      payload: { leadId, trigger: "email_click" },
      metadata: { leadId, priority: 3, agentSource: this.id },
    });

    return this.ok({ action: "email_clicked", leadId });
  }

  private async onEmailBounced(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    const leadId = event.metadata.leadId || event.payload.leadId;
    if (!leadId) return this.ok({ action: "no_lead" });

    // Mark email as invalid — don't send more emails to this lead
    await context.storage.updateLead(leadId, {
      email: null, // Clear bad email
    } as any);

    context.log("warn", `Email bounced for lead ${leadId} — cleared email address`);
    return this.ok({ action: "email_bounced", leadId, emailCleared: true });
  }

  private async onEmailUnsubscribed(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    const leadId = event.metadata.leadId || event.payload.leadId;
    if (!leadId) return this.ok({ action: "no_lead" });

    // Treat as opt-out for email channel
    await context.storage.updateLead(leadId, {
      consentStatus: "opted_out",
    } as any);

    context.emit({
      type: "lead.opted_out",
      organizationId: event.organizationId,
      payload: { leadId, channel: "email", reason: "unsubscribed" },
      metadata: { leadId, priority: 1, agentSource: this.id },
    });

    return this.ok({ action: "unsubscribed", leadId });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private getNextStep(lead: any): number {
    const attempts = (lead as any).outreachAttempts || 0;
    return Math.min(attempts + 1, 5);
  }
}
