// ─── VOICE AGENT ────────────────────────────────────────────────────────────
// Agent 1: Live AI outbound calls with Aria persona.
// Provider chain: Twilio (call) → ElevenLabs (TTS) → Claude (logic)
// Ported from Python VoiceAgent with full call lifecycle.

import { BaseAgent } from "../base-agent.js";
import { initiateCall, isTwilioConfigured } from "../../../lib/twilio.js";
import { AI_DISCLOSURE_STATES, OUTREACH_COSTS } from "../../config.js";
import type { ReactorEvent, AgentResult, AgentContext } from "../../types.js";

export class VoiceAgent extends BaseAgent {
  id = "voice-agent";
  name = "Voice Agent";
  tier = 1 as const;
  priority = 2;
  isBlocking = false;
  timeout = 15_000;

  private persona = "Aria";
  private costPerMin = OUTREACH_COSTS.voice_per_min;

  canHandle(event: ReactorEvent): boolean {
    return [
      "outreach.call.initiate",
      "call.connected",
      "call.speech_received",
      "call.ended",
      "call.no_answer",
      "call.voicemail_detected",
    ].includes(event.type);
  }

  protected async _execute(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    const leadId = event.metadata.leadId || event.payload.leadId;

    switch (event.type) {
      case "outreach.call.initiate":
        return this.initiateCall(event, leadId, context);
      case "call.connected":
        return this.onCallConnected(event, context);
      case "call.speech_received":
        return this.onSpeechReceived(event, context);
      case "call.voicemail_detected":
        return this.onVoicemailDetected(event, context);
      case "call.ended":
        return this.onCallEnded(event, leadId, context);
      case "call.no_answer":
        return this.onNoAnswer(event, leadId, context);
      default:
        return this.ok({ action: "unhandled" });
    }
  }

  private async initiateCall(event: ReactorEvent, leadId: number | undefined, context: AgentContext): Promise<AgentResult> {
    if (!leadId) return this.fail("No leadId");

    const lead = await context.storage.getLead(leadId);
    if (!lead) return this.fail("Lead not found");
    if (!lead.phone) return this.fail("Lead has no phone number");

    if (!isTwilioConfigured()) {
      return this.ok({ called: false, reason: "twilio_not_configured" });
    }

    // TODO: Build TwiML URL that connects to ElevenLabs WebSocket for Aria voice
    const twimlUrl = event.payload.twimlUrl || `${process.env.BASE_URL || ""}/api/webhooks/twilio/voice`;
    const result = await initiateCall(lead.phone, twimlUrl);

    await context.storage.updateLead(leadId, {
      outreachAttempts: ((lead as any).outreachAttempts || 0) + 1,
    } as any);

    context.emit({
      type: "outreach.result",
      organizationId: event.organizationId,
      payload: { leadId, channel: "voice", success: result.success, sid: result.sid, error: result.error },
      metadata: { leadId, priority: 4, agentSource: this.id },
    });

    return this.ok({ called: result.success, sid: result.sid });
  }

  private async onCallConnected(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    const lead = event.payload.lead || {};
    const tenant = event.payload.tenant || {};
    const state = lead.state || "";

    const openingPrompt = this.buildOpeningPrompt(lead, tenant, state);

    return this.ok(
      { prompt: openingPrompt, persona: this.persona, requireAiDisclosure: AI_DISCLOSURE_STATES.includes(state) },
      {
        emitEvents: [{
          type: "ai.generate_response",
          organizationId: event.organizationId,
          payload: {
            prompt: openingPrompt,
            context: "voice_call_opening",
            lead,
            persona: this.persona,
            requireAiDisclosure: AI_DISCLOSURE_STATES.includes(state),
          },
          metadata: { leadId: event.metadata.leadId, priority: 1, agentSource: this.id },
        }],
      }
    );
  }

  private async onSpeechReceived(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    const transcript = event.payload.transcript || "";

    // Route to sentiment classifier
    return this.ok(
      { transcript: transcript.substring(0, 100) },
      {
        emitEvents: [{
          type: "message.inbound",
          organizationId: event.organizationId,
          payload: { content: transcript, channel: "voice", leadId: event.metadata.leadId },
          metadata: { leadId: event.metadata.leadId, priority: 1, agentSource: this.id },
        }],
      }
    );
  }

  private async onVoicemailDetected(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    // Hand off to voicemail drop agent
    return this.ok(
      { action: "voicemail_handoff" },
      {
        emitEvents: [{
          type: "outreach.voicemail.drop",
          organizationId: event.organizationId,
          payload: event.payload,
          metadata: { leadId: event.metadata.leadId, priority: 4, agentSource: this.id },
        }],
      }
    );
  }

  private async onCallEnded(event: ReactorEvent, leadId: number | undefined, context: AgentContext): Promise<AgentResult> {
    const duration = event.payload.duration_seconds || 0;
    const costCents = Math.round((duration / 60) * this.costPerMin);
    const outcome = event.payload.outcome || "unknown";

    return this.ok(
      { duration, costCents, outcome },
      {
        costCents,
        emitEvents: [
          {
            type: "outreach.result",
            organizationId: event.organizationId,
            payload: { leadId, channel: "voice", outcome, duration, costCents },
            metadata: { leadId, priority: 4, agentSource: this.id },
          },
        ],
      }
    );
  }

  private async onNoAnswer(event: ReactorEvent, leadId: number | undefined, context: AgentContext): Promise<AgentResult> {
    // Emit voicemail drop as fallback
    return this.ok(
      { action: "no_answer_voicemail_fallback" },
      {
        emitEvents: [{
          type: "outreach.voicemail.drop",
          organizationId: event.organizationId,
          payload: { ...event.payload, trigger: "no_answer" },
          metadata: { leadId, priority: 5, agentSource: this.id },
        }],
      }
    );
  }

  // ─── Aria opening prompt (from Python VoiceAgent._build_opening_prompt) ──

  private buildOpeningPrompt(lead: any, tenant: any, state: string): string {
    const name = lead.name || lead.firstName || "there";
    const company = tenant.name || "our company";
    const industry = tenant.industry || "home services";
    const aiDisclosure = AI_DISCLOSURE_STATES.includes(state)
      ? "IMPORTANT: You MUST disclose you are an AI assistant at the start of the call. "
      : "";

    return `You are Aria, a friendly and professional AI assistant making an outbound call on behalf of ${company}.
${aiDisclosure}
The lead's name is ${name}. They previously expressed interest in ${industry} services but haven't followed up.

Your goal: Re-engage them warmly, understand their current situation, and if appropriate, offer to schedule a free consultation/appointment.

Rules:
- Be conversational, warm, and natural (slight British accent in delivery)
- Never be pushy or aggressive
- If they say they're not interested, acknowledge gracefully and ask ONE follow-up question
- If they have an objection, address it thoughtfully
- If they're interested, transition to appointment booking naturally
- If they ask to be removed, immediately comply and log opt-out
- Keep responses concise (2-3 sentences max per turn)
- Reference their specific situation if data is available

Begin with a natural greeting.`;
  }
}
