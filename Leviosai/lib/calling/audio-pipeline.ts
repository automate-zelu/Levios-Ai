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
import { sdrCallSessions, sdrConfigs, workspaces } from "../schema.js";
import { eq } from "drizzle-orm";
import { DeepgramSTTClient } from "./deepgram-client.js";
import { ElevenLabsClient } from "./elevenlabs-client.js";
import { LangChainCallAgent } from "./langchain-agent.js";
import { TranscriptStore, transcriptStoreFromJSON } from "./transcript-store.js";
import {
  LLM_RESPONSE_TIMEOUT_MS,
  TTS_TIMEOUT_MS,
  measureLatency,
  withTimeout,
} from "./pipeline-helpers.js";
import {
  clearSayFallbackRedirect,
  isSayFallbackRedirect,
  playTextViaTwilioSay,
  trackStreamClose,
  trackStreamOpen,
} from "./tts-fallback.js";

// ─── AUDIO PIPELINE ───────────────────────────────────────────────────────────

export class AudioPipeline {
  private deepgram    = new DeepgramSTTClient();
  private elevenlabs  = new ElevenLabsClient();
  private agent       = new LangChainCallAgent();
  private transcript  = new TranscriptStore();
  private streamSid   = "";
  private ended       = false;
  private isSpeaking  = false;
  private activeResponse: Promise<void> | null = null;
  private abortTTS: (() => void) | null = null;

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
      // Twilio <Say> fallback redirects the call → WS closes intentionally.
      // Another stream may already be open, or reconnect is still pending.
      if (remaining > 0 || isSayFallbackRedirect(sessionId)) {
        console.log(
          `📞 Stream closed without finalizing session ${sessionId} ` +
          `(remainingStreams=${remaining}, sayFallback=${isSayFallbackRedirect(sessionId)})`
        );
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

    const [config] = await db
      .select()
      .from(sdrConfigs)
      .where(eq(sdrConfigs.workspaceId, session.workspaceId));

    if (!config) {
      ws.close(1011, "SDR config not found — save your SDR Agent configuration first");
      return;
    }

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

    await this.agent.init({
      sessionId,
      systemPrompt: config.systemPrompt || "",
      workspaceId: session.workspaceId,
      organizationId: wsRow?.organizationId || 0,
      leadId: session.leadId ?? null,
    });
    console.log(`🤖 LangChain agent initialized for session ${sessionId}`);

    console.log(`🎙️  Deepgram connecting for session ${sessionId}...`);
    this.deepgram.connect().catch((err: Error) =>
      console.error(`🎙️  Deepgram connect error for session ${sessionId}:`, err.message)
    );

    this.deepgram.onTranscript(async (text: string) => {
      if (this.ended) return;

      if (this.isSpeaking) {
        if (this.abortTTS) {
          console.log(`🎙️  Barge-in — stopping AI speech: "${text}"`);
          this.clearTwilioAudio(ws);
          this.abortTTS();
          this.abortTTS = null;
          await new Promise(resolve => setTimeout(resolve, 150));
        } else {
          console.log(`🎙️  Transcript while AI generating (skipped): "${text}"`);
          return;
        }
      }

      this.transcript.append("lead", text);
      console.log(`👤 Lead said: "${text}"`);

      const responseTask = (async () => {
        const llmStartedAt = Date.now();
        let ttsStartedAt = llmStartedAt;
        try {
          this.isSpeaking = true;

          const aiResponse = await withTimeout(
            this.agent.respond(sessionId, text),
            LLM_RESPONSE_TIMEOUT_MS,
            "LLM respond"
          );

          if (!this.isSpeaking || this.ended) return;

          this.transcript.append("ai", aiResponse);
          console.log(`🤖 AI response: "${aiResponse.substring(0, 80)}"`);

          ttsStartedAt = Date.now();
          await this.streamTTS(ws, aiResponse, config.assistantVoiceId, sessionId);

          const latency = measureLatency(llmStartedAt, ttsStartedAt);
          const flag = latency.overBudget ? "⚠️" : "✅";
          console.log(
            `${flag} Pipeline latency session=${sessionId}: LLM=${latency.llmMs}ms TTS=${latency.ttsMs}ms total=${latency.totalMs}ms`
          );
        } catch (err: any) {
          console.error(`AI response error for session ${sessionId}:`, err.message);
          // TTS/LLM failure is non-fatal — keep listening for the next utterance
        } finally {
          this.isSpeaking = false;
          this.abortTTS = null;
          this.activeResponse = null;
        }
      })();

      this.activeResponse = responseTask;
      await responseTask;
    });

    this.deepgram.onError((err: Error) => {
      console.error(`🎙️  Deepgram error for session ${sessionId}:`, err.message);
    });

    onMessage = async (msg: any) => {
      switch (msg.event) {
        case "connected":
          break;

        case "start":
          this.streamSid = msg.start?.streamSid ?? "";
          console.log(`📞 Twilio stream started — streamSid: ${this.streamSid}`);
          await db
            .update(sdrCallSessions)
            .set({ twilioStreamSid: this.streamSid, status: "active" })
            .where(eq(sdrCallSessions.id, sessionId));

          // After <Say> fallback, Twilio already spoke the last AI line — don't re-greet.
          if (resumingAfterSay) {
            clearSayFallbackRedirect(sessionId);
            console.log(`📞 Skipping greeting — resumed after Twilio <Say> for ${sessionId}`);
            break;
          }

          try {
            console.log(`🤖 Generating greeting for session ${sessionId}...`);
            const greeting = await withTimeout(
              this.agent.respond(
                sessionId,
                "[CALL_CONNECTED] The call just connected. Deliver your opening greeting now."
              ),
              LLM_RESPONSE_TIMEOUT_MS,
              "LLM greeting"
            );
            console.log(`🤖 Greeting: "${greeting.substring(0, 100)}"`);
            this.transcript.append("ai", greeting);
            this.isSpeaking = true;
            await this.streamTTS(ws, greeting, config.assistantVoiceId, sessionId);
          } catch (err: any) {
            console.error(`Greeting failed for session ${sessionId}:`, err.message);
          } finally {
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

  private clearTwilioAudio(ws: WebSocket): void {
    if (ws.readyState === ws.OPEN && this.streamSid) {
      ws.send(JSON.stringify({ event: "clear", streamSid: this.streamSid }));
    }
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
    let receivedAudio = false;

    let audioStream;
    try {
      audioStream = await withTimeout(
        this.elevenlabs.synthesizeStream(text, voiceId),
        TTS_TIMEOUT_MS,
        "ElevenLabs TTS"
      );
    } catch (err: any) {
      await this.fallbackToTwilioSay(sessionId, text, err.message || "ElevenLabs open failed");
      return;
    }

    this.abortTTS = () => {
      aborted = true;
      try { audioStream.destroy(); } catch { /* ignore */ }
    };

    return new Promise((resolve) => {
      let firstChunk = true;
      let isMp3 = false;
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      // Hard safety: if stream hangs after open, don't block the turn forever
      const hangTimer = setTimeout(() => {
        if (!aborted) {
          console.warn(`TTS stream hang timeout for session ${sessionId}`);
          try { audioStream.destroy(); } catch { /* ignore */ }
        }
        if (!receivedAudio && !aborted) {
          this.fallbackToTwilioSay(sessionId, text, "ElevenLabs stream hang")
            .finally(() => settle());
          return;
        }
        settle();
      }, TTS_TIMEOUT_MS);

      audioStream.on("data", (rawChunk: any) => {
        if (aborted) { clearTimeout(hangTimer); settle(); return; }

        let chunk: Buffer = Buffer.isBuffer(rawChunk)
          ? rawChunk
          : Buffer.from(rawChunk as ArrayBufferLike);

        if (firstChunk) {
          firstChunk = false;
          const tag = chunk.slice(0, 4).toString("ascii");
          console.log(`🔊 First audio chunk: ${chunk.length} bytes`);
          if (tag === "RIFF") {
            chunk = chunk.slice(44);
          } else if (tag.startsWith("ID3")) {
            isMp3 = true;
            console.warn(`⚠️  ElevenLabs returned MP3 (ID3) — check ?output_format=ulaw_8000`);
          }
        }

        if (isMp3 || chunk.length === 0) return;
        receivedAudio = true;

        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({
            event:     "media",
            streamSid: this.streamSid,
            media:     { payload: chunk.toString("base64") },
          }));
        }
      });

      audioStream.on("end", () => {
        clearTimeout(hangTimer);
        if (!aborted && ws.readyState === ws.OPEN && this.streamSid) {
          ws.send(JSON.stringify({
            event:     "mark",
            streamSid: this.streamSid,
            mark:      { name: "tts-done" },
          }));
        }
        settle();
      });

      audioStream.on("error", (err: Error) => {
        clearTimeout(hangTimer);
        if (!aborted) {
          console.error(`ElevenLabs TTS error for session ${sessionId}:`, err.message);
          if (!receivedAudio) {
            this.fallbackToTwilioSay(sessionId, text, err.message).finally(() => settle());
            return;
          }
        }
        settle();
      });

      audioStream.on("close", () => {
        clearTimeout(hangTimer);
        settle();
      });
    });
  }

  private async endCall(sessionId: string, _ws: WebSocket): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    clearSayFallbackRedirect(sessionId);

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

      await db
        .update(sdrCallSessions)
        .set({
          transcript: fullTranscript,
          aiSummary: summary,
          outcome: mid ? "booked" : outcome,
          bookedScheduledAt,
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
    console.log(
      `📞 Pipeline ended session=${sessionId} lines=${this.transcript.lineCount} durationMs=${this.transcript.getDurationMs()}`
    );
  }
}
