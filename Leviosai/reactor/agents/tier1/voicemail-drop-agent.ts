// ─── VOICEMAIL DROP AGENT ────────────────────────────────────────────────────
// Ringless voicemail delivery. Pre-records AI-generated voicemails per lead,
// tracks delivery attempts, respects TCPA quiet hours and frequency limits.
// Future: Slybroadcast API integration for actual ringless delivery.

import { BaseAgent } from "../base-agent.js";
import { generateMessage } from "../../../lib/ai.js";
import { OUTREACH_COSTS } from "../../config.js";
import { evaluateQuietHours } from "../../../lib/compliance.js";
import type { ReactorEvent, AgentResult, AgentContext } from "../../types.js";

// Pre-defined voicemail scripts by sequence step
const VOICEMAIL_SCRIPTS: Record<number, string> = {
  1: `First voicemail. Be warm, friendly, and brief (under 30 seconds when spoken).
Introduce yourself as Aria from {company}. Mention you're following up on their inquiry.
End with: "Feel free to call or text us back at your convenience. Have a great day!"
Do NOT sound robotic. Sound like a real person leaving a message.`,

  2: `Second voicemail follow-up. Reference that you left a message before.
Add a small piece of value — mention a recent project or promotion.
Keep it under 25 seconds. End with an easy callback CTA.
Tone: casual, helpful, zero pressure.`,

  3: `Final voicemail. Keep it very short (15 seconds).
Mention this is your last follow-up. Leave the door open.
Tone: "Just wanted to make sure you got my earlier messages. No worries if timing isn't right — we're here if you need us."`,
};

// Max voicemail drops per lead per week
const MAX_VM_PER_WEEK = 2;

export class VoicemailDropAgent extends BaseAgent {
  id = "voicemail-drop";
  name = "Voicemail Drop Agent";
  tier = 1 as const;
  priority = 3;
  isBlocking = false;
  timeout = 20_000;

  private costPerDrop = OUTREACH_COSTS.voicemail_drop;

  canHandle(event: ReactorEvent): boolean {
    return event.type === "outreach.voicemail.drop";
  }

  protected async _execute(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    const leadId = event.metadata.leadId || event.payload.leadId;
    if (!leadId) return this.fail("No leadId");

    const lead = await context.storage.getLead(leadId);
    if (!lead) return this.fail("Lead not found");
    if (!lead.phone) return this.fail("Lead has no phone number");

    // ─── TCPA quiet hours check (lead timezone) ──────────────────────
    const quiet = evaluateQuietHours({
      phone: lead.phone,
      timezone: (lead as any).timezone,
    });
    if (!quiet.allowed) {
      context.log("info", `Voicemail blocked — outside quiet hours (${quiet.detail})`);
      return this.ok({
        sent: false,
        reason: "quiet_hours",
        retryAfter: quiet.nextAllowedAt?.toISOString() ?? null,
      });
    }

    // ─── Weekly frequency limit ──────────────────────────────────────
    if (await this.hitWeeklyLimit(leadId, context)) {
      context.log("info", `Voicemail blocked — weekly limit reached for lead ${leadId}`);
      return this.ok({ sent: false, reason: "weekly_vm_limit" });
    }

    // ─── Determine sequence step ─────────────────────────────────────
    const step = Math.min(event.payload.step || this.getNextStep(lead), 3);

    // ─── Generate voicemail script via AI ─────────────────────────────
    let script = event.payload.script;
    if (!script) {
      const scriptPrompt = (VOICEMAIL_SCRIPTS[step] || VOICEMAIL_SCRIPTS[1])
        .replace("{company}", "our team");

      const generated = await generateMessage(
        {
          firstName: lead.firstName,
          lastName: lead.lastName,
          source: lead.source,
          status: lead.status,
          additionalContext: `Generate a voicemail script. ${scriptPrompt}\n\nStep ${step} of 3 in the voicemail sequence.`,
        } as any,
        "sms" // use SMS channel for short-form generation
      );
      script = generated.message;
    }

    // ─── Record the voicemail drop attempt ────────────────────────────
    // In production this would call Slybroadcast API to deliver ringless VM.
    // For now we store it as a pending voicemail message and log the attempt.
    await context.storage.createLeadMessage({
      leadId,
      channel: "sms", // stored as SMS channel with voicemail indicator in content
      content: `[VOICEMAIL STEP ${step}] ${script}`,
      status: "pending", // would become "delivered" after Slybroadcast callback
      direction: "outbound",
      aiGenerated: !event.payload.script,
    });

    // Track outreach attempt
    await context.storage.updateLead(leadId, {
      outreachAttempts: ((lead as any).outreachAttempts || 0) + 1,
      lastContactedAt: new Date(),
    } as any);

    // Log the activity
    await context.storage.logActivity({
      organizationId: event.organizationId,
      entityType: "lead",
      entityId: leadId,
      action: "voicemail_drop",
      details: JSON.stringify({ step, scriptPreview: script.substring(0, 80), phone: lead.phone }),
    });

    // ─── Emit result event ────────────────────────────────────────────
    context.emit({
      type: "outreach.result",
      organizationId: event.organizationId,
      payload: {
        leadId,
        channel: "voicemail",
        success: true,
        step,
        delivery: "queued", // would be "delivered" with Slybroadcast
      },
      metadata: { leadId, priority: 4, agentSource: this.id },
    });

    // Schedule next voicemail if not final step
    if (step < 3) {
      const nextDelayHours = step === 1 ? 72 : 120; // 3 days after step 1, 5 days after step 2
      context.emit({
        type: "outreach.voicemail.drop",
        organizationId: event.organizationId,
        payload: { leadId, step: step + 1, scheduledDelayMs: nextDelayHours * 3600 * 1000 },
        metadata: { leadId, priority: 5, agentSource: this.id },
      });
    }

    context.log("info", `Voicemail step ${step} queued for lead ${leadId}`);

    return this.ok(
      { sent: true, step, delivery: "queued", scriptPreview: script.substring(0, 60) },
      { costCents: this.costPerDrop }
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private getNextStep(lead: any): number {
    const attempts = (lead as any).outreachAttempts || 0;
    return Math.min(Math.floor(attempts / 2) + 1, 3); // Slower cadence than SMS
  }

  private async hitWeeklyLimit(leadId: number, context: AgentContext): Promise<boolean> {
    try {
      const messages = await context.storage.getLeadMessages(leadId);
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      const weeklyVmCount = (messages || []).filter((m: any) =>
        m.direction === "outbound" &&
        m.content?.startsWith("[VOICEMAIL") &&
        m.createdAt && new Date(m.createdAt) > oneWeekAgo
      ).length;

      return weeklyVmCount >= MAX_VM_PER_WEEK;
    } catch {
      return false;
    }
  }
}
