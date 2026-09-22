// ─── AUDIO PIPELINE ───────────────────────────────────────────────────────────
// Handles the real-time WebSocket connection between Twilio and the AI stack.
// One AudioPipeline instance is created per call session and destroyed on call end.
//
// Data flow:
//   Twilio (mulaw audio) → Deepgram (STT) → LangChain Agent (GPT-4o + RAG)
//   → ElevenLabs (TTS) → Twilio (mulaw audio)
//
// KEY DESIGN DECISIONS:
// 1. ws handlers registered IMMEDIATELY — Twilio fires "start" within 50ms of WS open.
//    Events buffer in memory; flushed after async init completes.
// 2. Deepgram connect is fire-and-forget — greeting fires even if STT is unavailable.
// 3. Barge-in: when Deepgram fires a transcript while AI is speaking, we clear Twilio's
//    audio queue (send "clear" event) and start a new response.
// 4. Single-response lock — concurrent transcripts are ignored while AI is responding.
// 5. LLM / TTS timeouts — hung providers never block call teardown.
// 6. Deepgram mid-call drop — auto-reconnect then REST fallback (see deepgram-client).
// 7. ElevenLabs timeout/error — Twilio <Say> plain-text fallback, then stream reconnect (§18).

import type WebSocket from "ws";
import { db } from "../db.js";
import { sdrCallSessions, sdrConfigs, sdrEnrollments, workspaces, leads } from "../schema.js";
import { and, eq, sql } from "drizzle-orm";
import { DeepgramSTTClient } from "./deepgram-client.js";
import { ElevenLabsClient } from "./elevenlabs-client.js";
import { LangChainCallAgent } from "./langchain-agent.js";
import { TranscriptStore, transcriptStoreFromJSON } from "./transcript-store.js";
import { liveCallRegistry } from "./live-call-registry.js";
import { stateMachine } from "../sdr-state-machine.js";
import {
  LLM_RESPONSE_TIMEOUT_MS,
  TTS_TIMEOUT_MS,
  LEAD_TURN_GAP_MS,
  LEAD_TURN_MIN_WORDS,
  TWILIO_MULAW_FRAME_BYTES,
  TWILIO_MEDIA_FRAME_MS,
  GREETING_SILENCE_REPROMPT_MS,
  measureLatency,
  withTimeout,
  mergeUtteranceFragments,
  countWords,
  transcriptHasLeadSpeech,
  resolvePostCallOutcome,
  turnHoldMs,
  type SttSource,
  shortenGreeting,
} from "./pipeline-helpers.js";
import { buildLeadContextBlock } from "./lead-context.js";
import {
  buildClearFrame,
  buildOutboundMediaFrame,
  detectMediaStreamProvider,
  extractStreamId,
  type MediaStreamProvider,
} from "./media-stream-protocol.js";
import {
  clearSayFallbackRedirect,
  isSayFallbackRedirect,
  playTextViaTwilioSay,
  trackStreamClose,
  trackStreamOpen,
} from "./tts-fallback.js";

const livePipelines = new Map<string, AudioPipeline>();

/** Twilio hangup / status callback — stop greeting loops after the phone already dropped. */
export function abortCallPipeline(sessionId: string): void {
  const pipeline = livePipelines.get(sessionId);
  if (!pipeline) return;
  void pipeline.forceHangup(sessionId);
}

// ─── AUDIO PIPELINE ───────────────────────────────────────────────────────────

export class AudioPipeline {
  private deepgram    = new DeepgramSTTClient();
  private elevenlabs  = new ElevenLabsClient();
  private agent       = new LangChainCallAgent();
  private transcript  = new TranscriptStore();
  private streamSid   = "";
  private mediaProvider: MediaStreamProvider = "twilio";
  private ended       = false;
  private isSpeaking  = false;
  private activeResponse: Promise<void> | null = null;
  private abortTTS: (() => void) | null = null;
  /** Fragments collected while lead is still talking */
  private pendingLeadTurn = "";
  private leadTurnTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceRepromptTimer: ReturnType<typeof setTimeout> | null = null;
  private ttsModel: string | null = null;
  /** Set when this socket should not finalize the CRM session on close (Say redirect / refuse). */
  private suppressEndOnClose = false;

  async handleStream(ws: WebSocket, sessionId: string): Promise<void> {
    const pendingMessages: any[] = [];
    let ready = false;
    let onMessage: ((msg: any) => Promise<void>) | null = null;

    trackStreamOpen(sessionId);

    ws.on("message", async (raw: Buffer) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!ready || !onMessage) {
        pendingMessages.push(msg);
        return;
      }
      await onMessage(msg);
    });

    ws.on("close", () => {
      const remaining = trackStreamClose(sessionId);
      this.clearSilenceReprompt();
      // Twilio <Say> fallback redirects the call → WS closes intentionally.
      // Another stream may already be open, or reconnect is still pending.
      if (this.suppressEndOnClose || remaining > 0 || isSayFallbackRedirect(sessionId)) {
        console.log(
          `📞 Stream closed without finalizing session ${sessionId} ` +
          `(suppress=${this.suppressEndOnClose}, remainingStreams=${remaining}, sayFallback=${isSayFallbackRedirect(sessionId)})`
        );
        if (this.leadTurnTimer) {
          clearTimeout(this.leadTurnTimer);
          this.leadTurnTimer = null;
        }
        this.deepgram.disconnect();
        this.ended = true;
        return;
      }
      if (!this.ended) {
        this.endCall(sessionId, ws).catch((err: Error) =>
          console.error(`endCall error for session ${sessionId}:`, err.message)
        );
      }
    });

    ws.on("error", (err: Error) => {
      console.error(`WebSocket error for session ${sessionId}:`, err.message);
    });

    // ── Async init ────────────────────────────────────────────────────────────

    const [session] = await db
      .select()
      .from(sdrCallSessions)
      .where(eq(sdrCallSessions.id, sessionId));

    if (!session) { ws.close(1011, "Session not found"); return; }

    if (session.status === "completed" || session.endedAt) {
      console.log(`📞 Refusing stream — session ${sessionId} already completed`);
      this.suppressEndOnClose = true;
      trackStreamClose(sessionId);
      ws.close(1000, "session already completed");
      return;
    }

    livePipelines.set(sessionId, this);

    const [config] = await db
      .select()
      .from(sdrConfigs)
      .where(eq(sdrConfigs.workspaceId, session.workspaceId));

    if (!config) {
      ws.close(1011, "SDR config not found — save your SDR Agent configuration first");
      return;
    }
    this.ttsModel = (config as any).ttsModel || null;

    const [wsRow] = await db
      .select({ organizationId: workspaces.organizationId })
      .from(workspaces)
      .where(eq(workspaces.id, session.workspaceId));

    console.log(`📞 Pipeline starting for session ${sessionId} (workspace ${session.workspaceId})`);

    // Resume after Twilio <Say> fallback reconnect — restore transcript, skip re-greeting.
    const resumingAfterSay = isSayFallbackRedirect(sessionId);
    if (resumingAfterSay) {
      if (session.transcript) {
        try {
          // Prefer structured JSON if we stored lines; else seed from plain transcript.
          const parsed = JSON.parse(session.transcript);
          if (Array.isArray(parsed)) {
            this.transcript = transcriptStoreFromJSON(parsed);
          }
        } catch {
          // Plain "AI: …\nLEAD: …" — keep empty store; conversation continues via STT
        }
      }
      console.log(`📞 Resuming pipeline after Twilio <Say> fallback for session ${sessionId}`);
    }

    liveCallRegistry.start(sessionId, session.workspaceId, this.transcript.toJSON());
    liveCallRegistry.setStatus(sessionId, "active");

    let leadBlock = "";
    if (session.leadId) {
      try {
        const [lead] = await db.select().from(leads).where(eq(leads.id, session.leadId)).limit(1);
        if (lead) leadBlock = buildLeadContextBlock(lead);
      } catch (err: any) {
        console.warn(`Lead context load failed for session ${sessionId}:`, err.message);
      }
    }

    const systemPrompt = [config.systemPrompt || "", leadBlock].filter(Boolean).join("\n\n");

    await this.agent.init({
      sessionId,
      systemPrompt,
      workspaceId: session.workspaceId,
      organizationId: wsRow?.organizationId || 0,
      leadId: session.leadId ?? null,
      llmModel: (config as any).llmModel,
    });
    // Restore conversation memory after <Say> reconnect (new pipeline instance)
    if (this.transcript.lineCount > 0) {
      await this.agent.seedFromTranscript(sessionId, this.transcript.toJSON());
    }
    console.log(`🤖 LangChain agent initialized for session ${sessionId}`);

    console.log(`🎙️  Deepgram connecting for session ${sessionId}...`);
    this.deepgram.connect({ model: (config as any).sttModel || undefined }).catch((err: Error) =>
      console.error(`🎙️  Deepgram connect error for session ${sessionId}:`, err.message)
    );

    this.deepgram.onTranscript((text: string, meta) => {
      void this.onLeadTranscript(ws, sessionId, text, config.assistantVoiceId, meta?.source || "live");
    });

    // Partials only barge-in — never start an LLM turn from interim text
    this.deepgram.onPartial((text: string) => {
      if (!this.isSpeaking || !this.abortTTS || !text.trim()) return;
      console.log(`🎙️  Barge-in (partial) — stopping AI speech: "${text}"`);
      this.clearTwilioAudio(ws);
      this.abortTTS();
      this.abortTTS = null;
      this.isSpeaking = false;
    });

    this.deepgram.onError((err: Error) => {
      console.error(`🎙️  Deepgram error for session ${sessionId}:`, err.message);
    });

    onMessage = async (msg: any) => {
      switch (msg.event) {
        case "connected":
          break;

        case "start":
          this.mediaProvider = detectMediaStreamProvider(msg);
          this.streamSid = extractStreamId(msg);
          console.log(
            `📞 Media stream started (${this.mediaProvider}) — streamSid: ${this.streamSid}`
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

          // After <Say> fallback, Twilio already spoke the last AI line — don't re-greet.
          if (resumingAfterSay) {
            clearSayFallbackRedirect(sessionId);
            console.log(`📞 Skipping greeting — resumed after Twilio <Say> for ${sessionId}`);
            this.scheduleSilenceReprompt(ws, sessionId, config.assistantVoiceId);
            break;
          }

          try {
            // Brief settle — international carriers often open the stream before the human is on the line.
            await new Promise((r) => setTimeout(r, 300));
            if (this.ended) break;

            console.log(`🤖 Generating greeting for session ${sessionId}...`);
            const rawGreeting = await withTimeout(
              this.agent.respond(
                sessionId,
                "[OUTBOUND_CALL_CONNECTED] You just placed an OUTBOUND sales call to this lead " +
                  "(they did not call you). Deliver a VERY short opening only: one sentence, max ~15 words. " +
                  "State your name + company, that you are calling them, and ask if now is a good time. " +
                  "Do NOT sound like inbound support/receptionist. Do NOT pitch services yet."
              ),
              LLM_RESPONSE_TIMEOUT_MS,
              "LLM greeting"
            );
            const greeting = shortenGreeting(rawGreeting);
            if (greeting !== rawGreeting.trim()) {
              await this.agent.replaceLastAiMessage(sessionId, greeting);
            }
            console.log(`🤖 Greeting: "${greeting.substring(0, 100)}"`);
            this.appendLive(sessionId, "ai", greeting);

            // Speak on the live media stream. Keep STT live for barge-in (inbound ≠ agent audio).
            this.isSpeaking = true;
            try {
              await this.streamTTS(ws, greeting, config.assistantVoiceId, sessionId);
            } finally {
              this.isSpeaking = false;
              this.abortTTS = null;
            }
            this.scheduleSilenceReprompt(ws, sessionId, config.assistantVoiceId);
          } catch (err: any) {
            console.error(`Greeting failed for session ${sessionId}:`, err.message);
            this.isSpeaking = false;
            this.abortTTS = null;
          }
          break;

        case "media":
          if (msg.media?.payload) {
            this.deepgram.sendAudio(Buffer.from(msg.media.payload, "base64"));
          }
          break;

        case "mark":
          break;

        case "stop":
          // During Twilio <Say> redirect the old stream emits "stop" — do not finalize.
          if (this.suppressEndOnClose || isSayFallbackRedirect(sessionId)) {
            console.log(
              `📞 Ignoring stream stop during Say redirect/suppress for session ${sessionId}`
            );
            break;
          }
          await this.endCall(sessionId, ws);
          break;
      }
    };

    ready = true;
    if (pendingMessages.length > 0) {
      console.log(`📞 Flushing ${pendingMessages.length} buffered Twilio events for session ${sessionId}`);
      for (const msg of pendingMessages) {
        await onMessage(msg);
      }
    }
  }

  private clearSilenceReprompt(): void {
    if (this.silenceRepromptTimer) {
      clearTimeout(this.silenceRepromptTimer);
      this.silenceRepromptTimer = null;
    }
  }

  /**
   * If the lead never speaks after the opening, nudge once so silence isn't dead air.
   */
  private scheduleSilenceReprompt(
    ws: WebSocket,
    sessionId: string,
    voiceId: string | null | undefined
  ): void {
    this.clearSilenceReprompt();
    this.silenceRepromptTimer = setTimeout(() => {
      void (async () => {
        if (this.ended || transcriptHasLeadSpeech(this.transcript.getFullTranscript())) return;
        const nudge = "Hello? Can you hear me okay?";
        console.log(`📞 Silence re-prompt for session ${sessionId}`);
        this.appendLive(sessionId, "ai", nudge);
        this.isSpeaking = true;
        try {
          await this.streamTTS(ws, nudge, voiceId, sessionId);
        } catch (err: any) {
          console.error(`Silence re-prompt failed for ${sessionId}:`, err.message);
        } finally {
          this.isSpeaking = false;
          this.abortTTS = null;
        }
      })();
    }, GREETING_SILENCE_REPROMPT_MS);
  }

  private clearTwilioAudio(ws: WebSocket): void {
    if (ws.readyState === ws.OPEN && this.streamSid) {
      ws.send(buildClearFrame(this.mediaProvider, this.streamSid));
    }
  }

  /**
   * Buffer lead speech fragments and only reply after turnHoldMs of quiet.
   * Live STT already ends on acoustic silence — merge window is tiny.
   */
  private async onLeadTranscript(
    ws: WebSocket,
    sessionId: string,
    text: string,
    voiceId: string | null | undefined,
    source: SttSource = "live"
  ): Promise<void> {
    if (this.ended) return;
    this.clearSilenceReprompt();

    if (this.isSpeaking) {
      if (this.abortTTS) {
        console.log(`🎙️  Barge-in — stopping AI speech: "${text}"`);
        this.clearTwilioAudio(ws);
        this.abortTTS();
        this.abortTTS = null;
        this.isSpeaking = false;
      } else {
        console.log(`🎙️  Transcript while AI generating (queued into turn): "${text}"`);
      }
    }

    this.pendingLeadTurn = mergeUtteranceFragments(this.pendingLeadTurn, text);
    const gapMs = turnHoldMs(this.pendingLeadTurn, source);
    console.log(`👤 Lead (buffering turn, ${source}, hold=${gapMs}ms): "${this.pendingLeadTurn}"`);

    if (this.leadTurnTimer) clearTimeout(this.leadTurnTimer);
    this.leadTurnTimer = setTimeout(() => {
      this.leadTurnTimer = null;
      void this.flushLeadTurn(ws, sessionId, voiceId);
    }, gapMs);
  }

  private async flushLeadTurn(
    ws: WebSocket,
    sessionId: string,
    voiceId: string | null | undefined
  ): Promise<void> {
    if (this.ended) return;
    const text = this.pendingLeadTurn.trim();
    this.pendingLeadTurn = "";
    if (!text) return;

    if (countWords(text) < LEAD_TURN_MIN_WORDS) {
      console.log(`👤 Lead turn too short, skipping: "${text}"`);
      return;
    }

    // Wait only while AI audio is actually playing. After barge-in, isSpeaking is
    // false — allow the new lead turn through even if the prior TTS promise is winding down.
    if (this.isSpeaking) {
      console.log(`👤 Lead turn delayed until AI finishes speaking: "${text}"`);
      this.pendingLeadTurn = mergeUtteranceFragments(this.pendingLeadTurn, text);
      if (!this.leadTurnTimer) {
        this.leadTurnTimer = setTimeout(() => {
          this.leadTurnTimer = null;
          void this.flushLeadTurn(ws, sessionId, voiceId);
        }, turnHoldMs(this.pendingLeadTurn, "live"));
      }
      return;
    }
    if (this.activeResponse) {
      console.log(`👤 Lead turn waiting for in-flight LLM/TTS cleanup: "${text}"`);
      this.pendingLeadTurn = mergeUtteranceFragments(this.pendingLeadTurn, text);
      if (!this.leadTurnTimer) {
        this.leadTurnTimer = setTimeout(() => {
          this.leadTurnTimer = null;
          void this.flushLeadTurn(ws, sessionId, voiceId);
        }, 200);
      }
      return;
    }

    this.appendLive(sessionId, "lead", text);
    console.log(`👤 Lead said (complete turn): "${text}"`);

    try {
      const [liveSession] = await db
        .select({ enrollmentId: sdrCallSessions.enrollmentId })
        .from(sdrCallSessions)
        .where(eq(sdrCallSessions.id, sessionId));
      if (liveSession?.enrollmentId) {
        const [enr] = await db
          .select()
          .from(sdrEnrollments)
          .where(eq(sdrEnrollments.id, liveSession.enrollmentId));
        if (enr && stateMachine.canTransition(enr.status as any, "call_connected")) {
          await stateMachine.transition(enr.id, "call_connected", { reason: "lead_speech" });
        }
      }
    } catch (err: any) {
      console.error(`call_connected on lead speech failed for ${sessionId}:`, err.message);
    }

    const responseTask = (async () => {
      const llmStartedAt = Date.now();
      let ttsStartedAt = llmStartedAt;
      try {
        console.log(`🤖 Generating reply for lead turn: "${text.substring(0, 120)}"`);
        const aiResponse = await withTimeout(
          this.agent.respond(sessionId, text),
          LLM_RESPONSE_TIMEOUT_MS,
          "LLM respond"
        );

        if (this.ended) {
          console.warn(
            `🤖 Reply ready but call already ended — dropping TTS for session ${sessionId}: "${aiResponse.substring(0, 80)}"`
          );
          return;
        }

        this.appendLive(sessionId, "ai", aiResponse);
        console.log(`🤖 AI response: "${aiResponse.substring(0, 80)}"`);

        this.isSpeaking = true;
        ttsStartedAt = Date.now();
        try {
          await this.streamTTS(ws, aiResponse, voiceId, sessionId);
        } finally {
          /* STT stays live for barge-in */
        }

        const latency = measureLatency(llmStartedAt, ttsStartedAt);
        const flag = latency.overBudget ? "⚠️" : "✅";
        console.log(
          `${flag} Pipeline latency session=${sessionId}: LLM=${latency.llmMs}ms TTS=${latency.ttsMs}ms total=${latency.totalMs}ms`
        );
      } catch (err: any) {
        console.error(`AI response error for session ${sessionId}:`, err.message);
      } finally {
        this.isSpeaking = false;
        this.abortTTS = null;
        this.activeResponse = null;
        // If more speech arrived during the reply, process it
        if (this.pendingLeadTurn.trim() && !this.leadTurnTimer && !this.ended) {
          this.leadTurnTimer = setTimeout(() => {
            this.leadTurnTimer = null;
            void this.flushLeadTurn(ws, sessionId, voiceId);
          }, 250);
        }
      }
    })();

    this.activeResponse = responseTask;
    await responseTask;
  }

  /** Append to store + live registry, and checkpoint JSON for reconnect / monitor polling. */
  private appendLive(sessionId: string, speaker: "ai" | "lead", text: string): void {
    const at = Date.now();
    this.transcript.append(speaker, text, at);
    const lines = this.transcript.getLines();
    const last = lines[lines.length - 1];
    if (last) liveCallRegistry.append(sessionId, last);
    void this.persistTranscriptCheckpoint(sessionId);
  }

  /** Persist transcript so a Say→Stream reconnect can restore context. */
  private async persistTranscriptCheckpoint(sessionId: string): Promise<void> {
    try {
      await db
        .update(sdrCallSessions)
        .set({ transcript: JSON.stringify(this.transcript.toJSON()) })
        .where(eq(sdrCallSessions.id, sessionId));
    } catch (err: any) {
      console.warn(`Transcript checkpoint failed for ${sessionId}:`, err.message);
    }
  }

  /**
   * Plan §18: ElevenLabs timeout/error → Twilio <Say> reads plain text, call continues.
   * Redirects the live call (media stream closes); reconnect skips greeting.
   */
  private async fallbackToTwilioSay(sessionId: string, text: string, reason: string): Promise<void> {
    console.error(`TTS fallback → Twilio <Say> for ${sessionId}: ${reason}`);
    await this.persistTranscriptCheckpoint(sessionId);
    const result = await playTextViaTwilioSay(sessionId, text);
    if (!result.ok) {
      console.error(
        `Twilio <Say> fallback unavailable for ${sessionId} (${result.reason}) — call continues without audio this turn`
      );
    }
  }

  private async streamTTS(
    ws: WebSocket,
    text: string,
    voiceId: string | null | undefined,
    sessionId: string
  ): Promise<void> {
    let aborted = false;
    this.abortTTS = () => {
      aborted = true;
    };

    if (!this.streamSid || ws.readyState !== ws.OPEN) {
      await this.fallbackToTwilioSay(sessionId, text, "Twilio stream not open for TTS");
      return;
    }

    // Stream μ-law from ElevenLabs and pace 20ms frames as bytes arrive —
    // first audio reaches the lead ~synthesis TTFB, not after full render.
    let stream: import("stream").Readable;
    try {
      stream = await withTimeout(
        this.elevenlabs.synthesizeStream(text, voiceId, this.ttsModel),
        TTS_TIMEOUT_MS,
        "ElevenLabs TTS open"
      );
    } catch (err: any) {
      // Fallback: full-buffer synthesis
      try {
        const audio = await withTimeout(
          this.elevenlabs.synthesizeMulawBuffer(text, voiceId, this.ttsModel),
          TTS_TIMEOUT_MS,
          "ElevenLabs TTS buffer"
        );
        if (aborted || this.ended) return;
        await this.paceMulawToTwilio(ws, audio, () => aborted || this.ended, sessionId);
      } catch (err2: any) {
        await this.fallbackToTwilioSay(sessionId, text, err2.message || err.message || "ElevenLabs failed");
      }
      return;
    }

    let pending = Buffer.alloc(0);
    let sent = 0;
    const startedAt = Date.now();
    let firstByteAt = 0;

    try {
      for await (const chunk of stream) {
        if (aborted || this.ended || ws.readyState !== ws.OPEN) break;
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (!firstByteAt && buf.length) {
          firstByteAt = Date.now();
          console.log(
            `🔊 TTS first byte in ${firstByteAt - startedAt}ms session=${sessionId}`
          );
        }
        pending = Buffer.concat([pending, buf]);

        while (pending.length >= TWILIO_MULAW_FRAME_BYTES) {
          if (aborted || this.ended || ws.readyState !== ws.OPEN) break;
          const frame = pending.subarray(0, TWILIO_MULAW_FRAME_BYTES);
          pending = pending.subarray(TWILIO_MULAW_FRAME_BYTES);
          ws.send(
            buildOutboundMediaFrame(
              this.mediaProvider,
              this.streamSid,
              frame.toString("base64")
            )
          );
          sent += frame.length;
          await new Promise((r) => setTimeout(r, TWILIO_MEDIA_FRAME_MS));
        }
      }

      if (!aborted && !this.ended && pending.length > 0 && ws.readyState === ws.OPEN) {
        const payload = Buffer.concat([
          pending,
          Buffer.alloc(TWILIO_MULAW_FRAME_BYTES - pending.length, 0xff),
        ]);
        ws.send(
          buildOutboundMediaFrame(
            this.mediaProvider,
            this.streamSid,
            payload.toString("base64")
          )
        );
        sent += payload.length;
      }
    } catch (err: any) {
      if (!sent) {
        await this.fallbackToTwilioSay(sessionId, text, err.message || "TTS stream failed");
        return;
      }
      console.warn(`🔊 TTS stream ended early session=${sessionId}:`, err.message);
    }

    console.log(
      `🔊 Sent ${sent} μ-law bytes to ${this.mediaProvider} (~${(sent / 8000).toFixed(2)}s) session=${sessionId}`
    );

    if (!aborted && ws.readyState === ws.OPEN && this.streamSid) {
      if (this.mediaProvider === "telnyx") {
        ws.send(JSON.stringify({ event: "mark", mark: { name: "tts-done" } }));
      } else {
        ws.send(
          JSON.stringify({
            event: "mark",
            streamSid: this.streamSid,
            mark: { name: "tts-done" },
          })
        );
      }
    }

    if (!aborted && sent < 2000) {
      await this.fallbackToTwilioSay(sessionId, text, `Only ${sent} bytes reached media stream`);
    }
  }

  private async paceMulawToTwilio(
    ws: WebSocket,
    audio: Buffer,
    shouldStop: () => boolean,
    sessionId: string
  ): Promise<void> {
    let sent = 0;
    for (let i = 0; i < audio.length; i += TWILIO_MULAW_FRAME_BYTES) {
      if (shouldStop() || ws.readyState !== ws.OPEN) break;
      const frame = audio.subarray(i, Math.min(i + TWILIO_MULAW_FRAME_BYTES, audio.length));
      const payload =
        frame.length === TWILIO_MULAW_FRAME_BYTES
          ? frame
          : Buffer.concat([frame, Buffer.alloc(TWILIO_MULAW_FRAME_BYTES - frame.length, 0xff)]);
      ws.send(
        buildOutboundMediaFrame(
          this.mediaProvider,
          this.streamSid,
          payload.toString("base64")
        )
      );
      sent += payload.length;
      await new Promise((r) => setTimeout(r, TWILIO_MEDIA_FRAME_MS));
    }
    console.log(
      `🔊 Sent ${sent} μ-law bytes (buffered) to ${this.mediaProvider} (~${(sent / 8000).toFixed(2)}s) session=${sessionId}`
    );
  }

  /** Twilio status callback — finalize even if the media socket is still open. */
  async forceHangup(sessionId: string): Promise<void> {
    await this.endCall(sessionId, null as unknown as WebSocket);
  }

  private async endCall(sessionId: string, _ws: WebSocket): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    clearSayFallbackRedirect(sessionId);
    this.clearSilenceReprompt();

    if (this.leadTurnTimer) {
      clearTimeout(this.leadTurnTimer);
      this.leadTurnTimer = null;
    }
    this.pendingLeadTurn = "";
    this.deepgram.disconnect();

    if (this.activeResponse) {
      await Promise.race([
        this.activeResponse,
        new Promise(resolve => setTimeout(resolve, 15_000)),
      ]);
    }

    const fullTranscript = this.transcript.getFullTranscript();

    try {
      const analysed = fullTranscript.trim()
        ? await withTimeout(
            this.agent.analyseOutcome(fullTranscript),
            LLM_RESPONSE_TIMEOUT_MS,
            "outcome analysis"
          )
        : {
            outcome: "no_answer" as const,
            summary: "No conversation captured.",
            scheduledAt: null,
            appointmentTitle: null,
          };

      const { outcome, summary } = analysed;
      let bookedScheduledAt: Date | null = null;
      if (analysed.scheduledAt) {
        const parsed = new Date(analysed.scheduledAt);
        if (!Number.isNaN(parsed.getTime())) bookedScheduledAt = parsed;
      }

      // Mid-call tool booking wins over post-call parse
      const mid = this.agent.getMidCallBooking?.();
      if (mid?.scheduledAt) {
        bookedScheduledAt = mid.scheduledAt;
      }

      const leadSpoke = transcriptHasLeadSpeech(fullTranscript);
      const callConnected = Boolean(this.streamSid) || this.transcript.lineCount > 0;
      const resolvedOutcome = resolvePostCallOutcome({
        transcript: fullTranscript,
        analysedOutcome: outcome,
        midCallBooking: Boolean(mid),
        callConnected,
      });

      await db
        .update(sdrCallSessions)
        .set({
          transcript: fullTranscript,
          aiSummary: leadSpoke
            ? summary
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
      console.error(`Outcome analysis failed for session ${sessionId}:`, err.message);
      await db
        .update(sdrCallSessions)
        .set({
          transcript: fullTranscript,
          status: "completed",
          endedAt: new Date(),
          outcome: this.transcript.isEmpty ? "failed" : undefined,
        })
        .where(eq(sdrCallSessions.id, sessionId));
    }

    this.agent.cleanup(sessionId);
    liveCallRegistry.end(sessionId, "completed");
    if (livePipelines.get(sessionId) === this) {
      livePipelines.delete(sessionId);
    }
    console.log(
      `📞 Pipeline ended session=${sessionId} lines=${this.transcript.lineCount} durationMs=${this.transcript.getDurationMs()}`
    );
  }
}

/** Keep the first spoken greeting short even if the model over-talks. */
export { shortenGreeting } from "./pipeline-helpers.js";
