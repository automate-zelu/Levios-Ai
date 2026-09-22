/**
 * Twilio Media Stream ↔ OpenAI Realtime (single-stack voice).
 * Replaces Deepgram STT + LLM + ElevenLabs TTS for live calls when enabled.
 */

import type WebSocket from "ws";
import { db } from "../db.js";
import { sdrCallSessions, sdrConfigs, workspaces, leads } from "../schema.js";
import { and, eq, sql } from "drizzle-orm";
import { TranscriptStore } from "./transcript-store.js";
import { liveCallRegistry } from "./live-call-registry.js";
import { buildLeadContextBlock } from "./lead-context.js";
import { hasCalendarPromptBlock } from "../calendar/prompt-block.js";
import {
  LLM_RESPONSE_TIMEOUT_MS,
  transcriptHasLeadSpeech,
  resolvePostCallOutcome,
  withTimeout,
} from "./pipeline-helpers.js";
import {
  OpenAIRealtimeSession,
  mapToRealtimeVoice,
  useOpenAiRealtimeVoice,
} from "./openai-realtime-session.js";
import type { CallToolContext } from "./call-calendar-tools.js";
import {
  clearSayFallbackRedirect,
  isSayFallbackRedirect,
  trackStreamClose,
  trackStreamOpen,
} from "./tts-fallback.js";
import { LangChainCallAgent } from "./langchain-agent.js";
import {
  buildClearFrame,
  buildOutboundMediaFrame,
  detectMediaStreamProvider,
  extractStreamId,
  type MediaStreamProvider,
} from "./media-stream-protocol.js";

export { useOpenAiRealtimeVoice };

const liveRealtime = new Map<string, RealtimeAudioPipeline>();

export function abortRealtimePipeline(sessionId: string): void {
  const p = liveRealtime.get(sessionId);
  if (!p) return;
  void p.forceHangup(sessionId);
}

const VOICE_STYLE = `
## VOICE MODE (OpenAI Realtime — mandatory)
- You are on a live phone call. Keep every reply to ONE short spoken sentence (~15 words) unless answering a direct question that needs two.
- Never re-ask for name or phone if CRM data is on file — confirm changes only.
- Use calendar tools when offering or booking times; never invent slots.
- If interrupted, stop and listen; do not repeat the full pitch.
`.trim();

export class RealtimeAudioPipeline {
  private transcript = new TranscriptStore();
  private streamSid = "";
  private mediaProvider: MediaStreamProvider = "twilio";
  private ended = false;
  private suppressEndOnClose = false;
  private realtime: OpenAIRealtimeSession | null = null;
  private midCallBooking: { scheduledAt: Date; appointmentId: number } | null = null;
  private outcomeAgent = new LangChainCallAgent();
  private organizationId = 0;
  private leadId: number | null = null;

  async handleStream(ws: WebSocket, sessionId: string): Promise<void> {
    const pendingMessages: any[] = [];
    let ready = false;
    let onMessage: ((msg: any) => Promise<void>) | null = null;

    trackStreamOpen(sessionId);

    ws.on("message", async (raw: Buffer) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!ready || !onMessage) {
        pendingMessages.push(msg);
        return;
      }
      await onMessage(msg);
    });

    ws.on("close", () => {
      const remaining = trackStreamClose(sessionId);
      if (this.suppressEndOnClose || remaining > 0 || isSayFallbackRedirect(sessionId)) {
        this.realtime?.close();
        this.ended = true;
        return;
      }
      if (!this.ended) {
        this.endCall(sessionId).catch((err: Error) =>
          console.error(`Realtime endCall error ${sessionId}:`, err.message)
        );
      }
    });

    ws.on("error", (err: Error) => {
      console.error(`Realtime Twilio WS error ${sessionId}:`, err.message);
    });

    const [session] = await db
      .select()
      .from(sdrCallSessions)
      .where(eq(sdrCallSessions.id, sessionId));

    if (!session) {
      ws.close(1011, "Session not found");
      return;
    }
    if (session.status === "completed" || session.endedAt) {
      this.suppressEndOnClose = true;
      trackStreamClose(sessionId);
      ws.close(1000, "session already completed");
      return;
    }

    liveRealtime.set(sessionId, this);

    const [config] = await db
      .select()
      .from(sdrConfigs)
      .where(eq(sdrConfigs.workspaceId, session.workspaceId));

    if (!config) {
      ws.close(1011, "SDR config not found");
      return;
    }

    const [wsRow] = await db
      .select({ organizationId: workspaces.organizationId })
      .from(workspaces)
      .where(eq(workspaces.id, session.workspaceId));

    this.organizationId = wsRow?.organizationId || 0;
    this.leadId = session.leadId ?? null;

    let leadBlock = "";
    if (session.leadId) {
      try {
        const [lead] = await db.select().from(leads).where(eq(leads.id, session.leadId)).limit(1);
        if (lead) leadBlock = buildLeadContextBlock(lead);
      } catch (err: any) {
        console.warn(`Lead context load failed:`, err.message);
      }
    }

    const systemPrompt = [config.systemPrompt || "", leadBlock, VOICE_STYLE]
      .filter(Boolean)
      .join("\n\n");

    const enableTools =
      !!this.organizationId && hasCalendarPromptBlock(config.systemPrompt || "");

    const toolContext: CallToolContext = {
      organizationId: this.organizationId,
      leadId: this.leadId,
      midCallBooking: null,
      setMidCallBooking: (b) => {
        this.midCallBooking = b;
        toolContext.midCallBooking = b;
      },
    };

    // Outcome analysis still uses text LLM after hangup
    await this.outcomeAgent.init({
      sessionId,
      systemPrompt,
      workspaceId: session.workspaceId,
      organizationId: this.organizationId,
      leadId: this.leadId,
      llmModel: (config as any).llmModel,
    });

    liveCallRegistry.start(sessionId, session.workspaceId, this.transcript.toJSON());
    liveCallRegistry.setStatus(sessionId, "active");

    console.log(`📞 Realtime pipeline starting session=${sessionId}`);

    this.realtime = new OpenAIRealtimeSession({
      instructions: systemPrompt,
      voice: mapToRealtimeVoice(
        (config as any).assistantVoiceId || process.env.OPENAI_REALTIME_VOICE
      ),
      model: ((config as any).llmModel || process.env.OPENAI_REALTIME_MODEL || "").includes("realtime")
        ? (config as any).llmModel
        : process.env.OPENAI_REALTIME_MODEL,
      enableCalendarTools: enableTools,
      toolContext,
      onReady: () => console.log(`🎙️  Realtime session ready ${sessionId}`),
      onLeadTranscript: (text) => this.appendLive(sessionId, "lead", text),
      onAiTranscript: (text) => {
        this.appendLive(sessionId, "ai", text);
      },
      onBargeIn: () => {
        // Only after confirmed user interruption — clear queued agent audio
        if (ws.readyState === ws.OPEN && this.streamSid) {
          ws.send(buildClearFrame(this.mediaProvider, this.streamSid));
        }
      },
      onAudioDelta: (b64) => {
        if (this.ended || ws.readyState !== ws.OPEN || !this.streamSid) return;
        ws.send(buildOutboundMediaFrame(this.mediaProvider, this.streamSid, b64));
      },
      onError: (err) => console.error(`Realtime session error ${sessionId}:`, err.message),
    });

    try {
      await this.realtime.connect();
    } catch (err: any) {
      console.error(`Realtime connect failed ${sessionId}:`, err.message);
      ws.close(1011, "realtime connect failed");
      return;
    }

    onMessage = async (msg: any) => {
      switch (msg.event) {
        case "connected":
          break;

        case "start":
          this.mediaProvider = detectMediaStreamProvider(msg);
          this.streamSid = extractStreamId(msg);
          console.log(
            `📞 Media stream (realtime/${this.mediaProvider}) streamSid=${this.streamSid}`
          );
          await db
            .update(sdrCallSessions)
            .set({ twilioStreamSid: this.streamSid, status: "active" })
            .where(
              and(
                eq(sdrCallSessions.id, sessionId),
                sql`${sdrCallSessions.status} IS DISTINCT FROM 'completed'`
              )
            );

          await new Promise((r) => setTimeout(r, 250));
          if (!this.ended) {
            console.log(`🤖 Realtime greeting for ${sessionId}`);
            this.realtime?.requestGreeting();
          }
          break;

        case "media":
          if (msg.media?.payload) {
            this.realtime?.appendAudioBase64(msg.media.payload);
          }
          break;

        case "stop":
          if (this.suppressEndOnClose || isSayFallbackRedirect(sessionId)) break;
          await this.endCall(sessionId);
          break;

        default:
          break;
      }
    };

    ready = true;
    for (const msg of pendingMessages) {
      await onMessage(msg);
    }
  }

  async forceHangup(sessionId: string): Promise<void> {
    await this.endCall(sessionId);
  }

  private appendLive(sessionId: string, speaker: "ai" | "lead", text: string): void {
    const at = Date.now();
    this.transcript.append(speaker, text, at);
    const lines = this.transcript.getLines();
    const last = lines[lines.length - 1];
    if (last) liveCallRegistry.append(sessionId, last);
    void db
      .update(sdrCallSessions)
      .set({ transcript: JSON.stringify(this.transcript.toJSON()) })
      .where(eq(sdrCallSessions.id, sessionId))
      .catch(() => undefined);
  }

  private async endCall(sessionId: string): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    clearSayFallbackRedirect(sessionId);
    this.realtime?.close();
    this.realtime = null;

    const fullTranscript = this.transcript.getFullTranscript();

    try {
      const analysed = fullTranscript.trim()
        ? await withTimeout(
            this.outcomeAgent.analyseOutcome(fullTranscript),
            LLM_RESPONSE_TIMEOUT_MS,
            "outcome analysis"
          )
        : {
            outcome: "no_answer" as const,
            summary: "No conversation captured.",
            scheduledAt: null,
            appointmentTitle: null,
          };

      let bookedScheduledAt: Date | null = null;
      if (analysed.scheduledAt) {
        const parsed = new Date(analysed.scheduledAt);
        if (!Number.isNaN(parsed.getTime())) bookedScheduledAt = parsed;
      }
      if (this.midCallBooking?.scheduledAt) {
        bookedScheduledAt = this.midCallBooking.scheduledAt;
      }

      const leadSpoke = transcriptHasLeadSpeech(fullTranscript);
      const callConnected = Boolean(this.streamSid) || this.transcript.lineCount > 0;
      const resolvedOutcome = resolvePostCallOutcome({
        transcript: fullTranscript,
        analysedOutcome: analysed.outcome,
        midCallBooking: Boolean(this.midCallBooking),
        callConnected,
      });

      await db
        .update(sdrCallSessions)
        .set({
          transcript: fullTranscript,
          aiSummary: leadSpoke
            ? analysed.summary
            : callConnected
              ? "Call was answered but no lead speech was captured."
              : "No lead speech captured (missed / voicemail).",
          outcome: resolvedOutcome,
          bookedScheduledAt: resolvedOutcome === "booked" ? bookedScheduledAt : null,
          status: "completed",
          endedAt: new Date(),
        })
        .where(eq(sdrCallSessions.id, sessionId));
    } catch (err: any) {
      console.error(`Realtime outcome failed ${sessionId}:`, err.message);
      await db
        .update(sdrCallSessions)
        .set({
          transcript: fullTranscript,
          status: "completed",
          endedAt: new Date(),
        })
        .where(eq(sdrCallSessions.id, sessionId));
    }

    this.outcomeAgent.cleanup(sessionId);
    liveCallRegistry.end(sessionId, "completed");
    if (liveRealtime.get(sessionId) === this) liveRealtime.delete(sessionId);
    console.log(
      `📞 Realtime pipeline ended session=${sessionId} lines=${this.transcript.lineCount}`
    );
  }
}
