// ─── DEEPGRAM STT CLIENT ──────────────────────────────────────────────────────
// Production path: Live WebSocket with acoustic utterance-end (SDK v5 requires
// connection.connect() + waitForOpen()). REST is a last-resort fallback only.

import { DeepgramClient } from "@deepgram/sdk";
import {
  DEEPGRAM_MAX_RECONNECTS,
  DEEPGRAM_RECONNECT_DELAY_MS,
  DEEPGRAM_REST_FLUSH_MS,
  shouldReconnectDeepgram,
  shouldAcceptRestTranscript,
  accumulateRestTranscript,
  turnHoldMs,
  LEAD_TURN_MIN_WORDS,
  type SttSource,
} from "./pipeline-helpers.js";

// Live endpointing — silence before is_final / UtteranceEnd
const UTTERANCE_END_MS = 1000;
const ENDPOINTING_MS = 400;
const WSS_OPEN_TIMEOUT_MS = 8000;

export type TranscriptHandler = (text: string, meta: { source: SttSource }) => void;

// ─── µ-LAW → PCM DECODER (needed to build WAV for REST) ──────────────────────

function mulawToLinear(byte: number): number {
  byte = ~byte & 0xff;
  const sign = byte & 0x80;
  const exp = (byte >> 4) & 0x07;
  const mantissa = byte & 0x0f;
  let linear = ((mantissa << 3) + 33) << exp;
  linear -= 33;
  return sign ? -linear : linear;
}

function mulawToWav(mulaw: Buffer): Buffer {
  const pcm = Buffer.alloc(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) {
    pcm.writeInt16LE(mulawToLinear(mulaw[i]), i * 2);
  }
  const hdr = Buffer.alloc(44);
  hdr.write("RIFF", 0);
  hdr.writeUInt32LE(36 + pcm.length, 4);
  hdr.write("WAVE", 8);
  hdr.write("fmt ", 12);
  hdr.writeUInt32LE(16, 16);
  hdr.writeUInt16LE(1, 20);
  hdr.writeUInt16LE(1, 22);
  hdr.writeUInt32LE(8000, 24);
  hdr.writeUInt32LE(16000, 28);
  hdr.writeUInt16LE(2, 32);
  hdr.writeUInt16LE(16, 34);
  hdr.write("data", 36);
  hdr.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([hdr, pcm]);
}

function pcm16ToWav(pcm: Buffer, sampleRate: number): Buffer {
  const hdr = Buffer.alloc(44);
  hdr.write("RIFF", 0);
  hdr.writeUInt32LE(36 + pcm.length, 4);
  hdr.write("WAVE", 8);
  hdr.write("fmt ", 12);
  hdr.writeUInt32LE(16, 16);
  hdr.writeUInt16LE(1, 20);
  hdr.writeUInt16LE(1, 22);
  hdr.writeUInt32LE(sampleRate, 24);
  hdr.writeUInt32LE(sampleRate * 2, 28);
  hdr.writeUInt16LE(2, 32);
  hdr.writeUInt16LE(16, 34);
  hdr.write("data", 36);
  hdr.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([hdr, pcm]);
}

function hasVoice(mulaw: Buffer): boolean {
  let active = 0;
  for (const b of mulaw) {
    const amp = Math.abs((~b & 0x7f) - 0x40);
    if (amp > 8) active++;
  }
  return active / mulaw.length > 0.08;
}

// ─── CLIENT ──────────────────────────────────────────────────────────────────

export class DeepgramSTTClient {
  private connection: any = null;
  private isOpen = false;
  private audioQueue: Buffer[] = [];
  private onTranscriptCallback: TranscriptHandler | null = null;
  private onErrorCallback: ((err: Error) => void) | null = null;

  private restMode = false;
  private restBuffer: Buffer[] = [];
  private restTimer: ReturnType<typeof setInterval> | null = null;
  private restPendingText = "";
  private restEmitTimer: ReturnType<typeof setTimeout> | null = null;
  private restSilentFlushes = 0;
  private apiKey = "";

  private encoding: "mulaw" | "linear16" = "mulaw";
  private sampleRate = 8000;
  private model = "nova-2-phonecall";
  private onPartialCallback: ((text: string) => void) | null = null;

  private pendingUtterance = "";

  private intentionallyClosed = false;
  private reconnectAttempts = 0;
  private connecting = false;

  /** True when live WSS is active (not REST fallback). */
  get isLive(): boolean {
    return this.isOpen && !this.restMode;
  }

  async connect(opts?: {
    encoding?: "mulaw" | "linear16";
    sampleRate?: number;
    model?: string;
  }): Promise<void> {
    if (this.connecting) return;
    this.connecting = true;
    this.intentionallyClosed = false;
    if (opts?.encoding) this.encoding = opts.encoding;
    if (opts?.sampleRate) this.sampleRate = opts.sampleRate;
    if (opts?.model) this.model = opts.model;

    try {
      const apiKey = process.env.DEEPGRAM_API_KEY;
      if (!apiKey) throw new Error("DEEPGRAM_API_KEY is not set");
      this.apiKey = apiKey;

      const dg = new DeepgramClient({ apiKey } as any);

      // SDK v5: connect() returns a socket that is NOT open until socket.connect()
      this.connection = await dg.listen.v1.connect({
        model: this.model,
        language: "en-US",
        interim_results: "true",
        endpointing: String(ENDPOINTING_MS),
        utterance_end_ms: String(UTTERANCE_END_MS),
        vad_events: "true",
        punctuate: "true",
        smart_format: "true",
        encoding: this.encoding,
        sample_rate: String(this.sampleRate),
      } as any);

      this.connection.on("open", () => {
        console.log("🎙️  Deepgram WebSocket open (live turn-aware STT)");
        this.isOpen = true;
        this.restMode = false;
        this.reconnectAttempts = 0;
        if (this.audioQueue.length > 0) {
          console.log(`🎙️  Flushing ${this.audioQueue.length} queued audio chunks`);
          for (const chunk of this.audioQueue) {
            try {
              this.connection.sendMedia(chunk);
            } catch {
              /* ignore */
            }
          }
          this.audioQueue = [];
        }
      });

      this.connection.on("message", (data: any) => {
        this.handleLiveMessage(data);
      });

      this.connection.on("error", (err: Error) => {
        console.error("🎙️  Deepgram WSS error:", err?.message ?? err);
        if (this.onErrorCallback) {
          this.onErrorCallback(err instanceof Error ? err : new Error(String(err)));
        }
      });

      this.connection.on("close", () => {
        console.log("🎙️  Deepgram connection closed");
        this.isOpen = false;
        this.handleUnexpectedClose();
      });

      // Critical for SDK v5 — without this, open never fires and we fall to REST
      this.connection.connect();

      // If the socket was already open from createWebSocketConnection, mark live now
      if (this.connection.readyState === 1) {
        this.isOpen = true;
        this.restMode = false;
        console.log("🎙️  Deepgram WebSocket already open (live turn-aware STT)");
      } else {
        try {
          await Promise.race([
            this.connection.waitForOpen(),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error(`WSS open timeout ${WSS_OPEN_TIMEOUT_MS}ms`)),
                WSS_OPEN_TIMEOUT_MS
              )
            ),
          ]);
          this.isOpen = true;
          this.restMode = false;
        } catch (err: any) {
          console.warn(`🎙️  Deepgram live open failed (${err?.message || err}) — REST fallback`);
          this.fallbackToRest();
        }
      }
    } catch (err: any) {
      console.error("🎙️  Deepgram connect error:", err?.message || err);
      this.fallbackToRest();
    } finally {
      this.connecting = false;
    }
  }

  private fallbackToRest(): void {
    if (this.restMode) return;
    this.restMode = true;
    this.isOpen = false;
    console.log("🎙️  Using REST batch transcription (higher latency — live WSS unavailable)");
    this.startRestLoop();
  }

  private handleLiveMessage(data: any): void {
    if (!data) return;

    if (data.type === "UtteranceEnd") {
      this.flushPending("UtteranceEnd");
      return;
    }

    if (data.type !== "Results") return;

    const transcript = data?.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
    const isFinal = !!data.is_final;
    const speechFinal = !!data.speech_final;

    if (!isFinal) {
      if (transcript && this.onPartialCallback) this.onPartialCallback(transcript);
      return;
    }

    if (transcript) {
      this.pendingUtterance = this.pendingUtterance
        ? `${this.pendingUtterance} ${transcript}`.replace(/\s+/g, " ").trim()
        : transcript;
      console.log(
        `🎙️  Final fragment${speechFinal ? " (speech_final)" : ""}: "${transcript}"` +
          (this.pendingUtterance !== transcript ? ` → pending "${this.pendingUtterance}"` : "")
      );
    }

    if (speechFinal) {
      this.flushPending("speech_final");
    }
  }

  private flushPending(reason: string): void {
    const text = this.pendingUtterance.trim();
    this.pendingUtterance = "";
    if (!text || !this.onTranscriptCallback) return;
    console.log(`🎙️  Turn complete (${reason}): "${text}"`);
    this.onTranscriptCallback(text, { source: "live" });
  }

  private handleUnexpectedClose(): void {
    if (!shouldReconnectDeepgram(this.intentionallyClosed, this.reconnectAttempts)) {
      if (!this.intentionallyClosed && !this.restMode) {
        console.log("🎙️  Deepgram reconnect exhausted — switching to REST fallback");
        this.fallbackToRest();
      }
      return;
    }

    this.reconnectAttempts += 1;
    console.log(
      `🎙️  Deepgram reconnect attempt ${this.reconnectAttempts}/${DEEPGRAM_MAX_RECONNECTS} in ${DEEPGRAM_RECONNECT_DELAY_MS}ms`
    );
    setTimeout(() => {
      this.connect().catch((err: Error) => {
        console.error("🎙️  Deepgram reconnect failed:", err.message);
        if (this.onErrorCallback) this.onErrorCallback(err);
      });
    }, DEEPGRAM_RECONNECT_DELAY_MS);
  }

  muteInput(): void {
    this.restBuffer = [];
  }

  unmuteInput(): void {
    this.restBuffer = [];
  }

  sendAudio(chunk: Buffer): void {
    if (this.restMode) {
      this.restBuffer.push(chunk);
      return;
    }

    if (!this.connection || !this.isOpen) {
      if (this.audioQueue.length < 200) this.audioQueue.push(chunk);
      return;
    }

    try {
      this.connection.sendMedia(chunk);
    } catch (err: any) {
      console.error("🎙️  sendMedia error:", err.message);
      this.isOpen = false;
    }
  }

  onTranscript(callback: TranscriptHandler | null): void {
    this.onTranscriptCallback = callback;
  }

  onPartial(callback: ((text: string) => void) | null): void {
    this.onPartialCallback = callback;
  }

  onError(callback: (err: Error) => void): void {
    this.onErrorCallback = callback;
  }

  disconnect(): void {
    this.intentionallyClosed = true;
    this.isOpen = false;
    this.connecting = false;
    this.audioQueue = [];
    this.restBuffer = [];
    this.restPendingText = "";
    this.restSilentFlushes = 0;
    this.pendingUtterance = "";
    if (this.restEmitTimer) {
      clearTimeout(this.restEmitTimer);
      this.restEmitTimer = null;
    }
    if (this.restTimer) {
      clearInterval(this.restTimer);
      this.restTimer = null;
    }
    if (this.connection) {
      try {
        this.connection.close();
      } catch {
        /* ignore */
      }
      this.connection = null;
    }
  }

  private startRestLoop(): void {
    if (this.restTimer) return;
    this.restTimer = setInterval(() => this.flushRestBuffer(), DEEPGRAM_REST_FLUSH_MS);
  }

  private async flushRestBuffer(): Promise<void> {
    if (this.restBuffer.length === 0) {
      this.noteRestSilence();
      return;
    }

    const chunks = this.restBuffer.splice(0);
    const raw = Buffer.concat(chunks);

    if (this.encoding === "linear16") {
      if (raw.length < this.sampleRate) {
        this.noteRestSilence();
        return;
      }
      try {
        const wav = pcm16ToWav(raw, this.sampleRate);
        const transcript = await this.transcribeWav(wav);
        this.queueRestTranscript(transcript);
      } catch (err: any) {
        console.error("🎙️  Deepgram REST fetch error:", err.message);
      }
      return;
    }

    if (raw.length < 4000 || !hasVoice(raw)) {
      this.noteRestSilence();
      return;
    }

    try {
      const wav = mulawToWav(raw);
      const transcript = await this.transcribeWav(wav);
      this.queueRestTranscript(transcript);
    } catch (err: any) {
      console.error("🎙️  Deepgram REST fetch error:", err.message);
    }
  }

  private noteRestSilence(): void {
    if (!this.restPendingText.trim()) {
      this.restSilentFlushes = 0;
      return;
    }
    this.restSilentFlushes += 1;
    // Require 2 silent batches (~1.8s) so mid-sentence pauses don't finalize early
    if (this.restSilentFlushes >= 2) {
      this.flushRestPending("silence");
    }
  }

  private queueRestTranscript(transcript: string): void {
    if (!transcript?.trim()) {
      this.noteRestSilence();
      return;
    }

    this.restSilentFlushes = 0;
    this.restPendingText = accumulateRestTranscript(this.restPendingText, transcript);

    if (!shouldAcceptRestTranscript(this.restPendingText, LEAD_TURN_MIN_WORDS)) {
      console.log(`🎙️  Transcript held (too short): "${this.restPendingText || transcript}"`);
      return;
    }

    console.log(`🎙️  Transcript (REST buffering): "${this.restPendingText}"`);

    if (this.restEmitTimer) clearTimeout(this.restEmitTimer);
    const holdMs = turnHoldMs(this.restPendingText, "rest");
    this.restEmitTimer = setTimeout(() => {
      this.restEmitTimer = null;
      this.flushRestPending("hold");
    }, holdMs);
  }

  private flushRestPending(reason: string): void {
    if (this.restEmitTimer) {
      clearTimeout(this.restEmitTimer);
      this.restEmitTimer = null;
    }
    const text = this.restPendingText.trim();
    this.restPendingText = "";
    this.restSilentFlushes = 0;
    if (!text || !this.onTranscriptCallback) return;
    console.log(`🎙️  Transcript (REST ${reason}): "${text}"`);
    this.onTranscriptCallback(text, { source: "rest" });
  }

  private async transcribeWav(wav: Buffer): Promise<string> {
    const params = new URLSearchParams({
      model: this.model,
      language: "en-US",
      punctuate: "true",
      smart_format: "true",
      filler_words: "false",
    });
    const response = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${this.apiKey}`,
        "Content-Type": "audio/wav",
      },
      body: wav as any,
    });
    if (!response.ok) {
      const err = await response.text();
      console.error("🎙️  Deepgram REST error:", err);
      if (this.model === "nova-2-phonecall" && response.status === 400) {
        this.model = "nova-2";
        return this.transcribeWav(wav);
      }
      return "";
    }
    const result = (await response.json()) as any;
    return result?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || "";
  }
}
