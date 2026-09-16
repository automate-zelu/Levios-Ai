// ─── DEEPGRAM STT CLIENT ──────────────────────────────────────────────────────
// Two modes, auto-selected at connect time:
//
// MODE 1 — WebSocket (live): dg.listen.v1.connect()
//   Emits a transcript only after the speaker pauses (speech_final / UtteranceEnd),
//   so the call agent does not reply mid-sentence.
//
// MODE 2 — REST fallback: batch HTTPS every few seconds when WSS is blocked.

import { DeepgramClient } from "@deepgram/sdk";
import {
  DEEPGRAM_MAX_RECONNECTS,
  DEEPGRAM_RECONNECT_DELAY_MS,
  shouldReconnectDeepgram,
} from "./pipeline-helpers.js";

// Silence Deepgram should see before declaring end-of-utterance (~1.4s).
const UTTERANCE_END_MS = 1400;
// Internal endpointing for is_final segments (shorter than utterance end).
const ENDPOINTING_MS = 700;

// ─── µ-LAW → PCM DECODER (needed to build WAV for REST) ──────────────────────

function mulawToLinear(byte: number): number {
  byte = ~byte & 0xff;
  const sign     = byte & 0x80;
  const exp      = (byte >> 4) & 0x07;
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
  hdr.write("RIFF",     0);
  hdr.writeUInt32LE(36 + pcm.length, 4);
  hdr.write("WAVE",     8);
  hdr.write("fmt ",    12);
  hdr.writeUInt32LE(16, 16);
  hdr.writeUInt16LE(1,  20);
  hdr.writeUInt16LE(1,  22);
  hdr.writeUInt32LE(8000, 24);
  hdr.writeUInt32LE(16000, 28);
  hdr.writeUInt16LE(2,  32);
  hdr.writeUInt16LE(16, 34);
  hdr.write("data",    36);
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
    const amp = Math.abs(((~b & 0x7f)) - 0x40);
    if (amp > 8) active++;
  }
  return active / mulaw.length > 0.08;
}

// ─── CLIENT ──────────────────────────────────────────────────────────────────

export class DeepgramSTTClient {
  private connection: any = null;
  private isOpen = false;
  private audioQueue: Buffer[] = [];
  private onTranscriptCallback: ((text: string) => void) | null = null;
  private onErrorCallback: ((err: Error) => void) | null = null;

  private restMode = false;
  private restBuffer: Buffer[] = [];
  private restTimer: ReturnType<typeof setInterval> | null = null;
  private apiKey = "";

  private muted = false;
  private encoding: "mulaw" | "linear16" = "mulaw";
  private sampleRate = 8000;
  private model = "nova-2";
  private onPartialCallback: ((text: string) => void) | null = null;

  // Accumulate finals until speech_final / UtteranceEnd
  private pendingUtterance = "";

  // Reconnect / lifecycle
  private intentionallyClosed = false;
  private reconnectAttempts = 0;
  private connecting = false;

  async connect(opts?: { encoding?: "mulaw" | "linear16"; sampleRate?: number; model?: string }): Promise<void> {
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

      // interim_results + utterance_end_ms required for reliable turn boundaries
      this.connection = await dg.listen.v1.connect({
        model:            this.model,
        language:         "en-US",
        interim_results:  true,
        endpointing:      ENDPOINTING_MS,
        utterance_end_ms: UTTERANCE_END_MS,
        vad_events:       true,
        encoding:         this.encoding,
        sample_rate:      this.sampleRate,
      } as any);

      // Switch to REST fallback if WSS doesn't open within 4 seconds
      const wssTimer = setTimeout(() => {
        if (!this.isOpen && !this.intentionallyClosed) {
          console.log("🎙️  WSS blocked — switching to REST batch transcription (2-3s latency)");
          this.restMode = true;
          this.startRestLoop();
        }
      }, 4000);

      this.connection.on("open", () => {
        clearTimeout(wssTimer);
        console.log("🎙️  Deepgram WebSocket open (real-time mode, turn-aware)");
        this.isOpen = true;
        this.reconnectAttempts = 0;
        if (this.audioQueue.length > 0) {
          console.log(`🎙️  Flushing ${this.audioQueue.length} queued audio chunks`);
          for (const chunk of this.audioQueue) {
            try { this.connection.sendMedia(chunk); } catch { /* ignore */ }
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
    } finally {
      this.connecting = false;
    }
  }

  private handleLiveMessage(data: any): void {
    if (!data) return;

    // End-of-utterance after configured silence
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

    // Speaker paused enough for Deepgram to mark speech complete
    if (speechFinal) {
      this.flushPending("speech_final");
    }
  }

  private flushPending(reason: string): void {
    const text = this.pendingUtterance.trim();
    this.pendingUtterance = "";
    if (!text || !this.onTranscriptCallback) return;
    console.log(`🎙️  Turn complete (${reason}): "${text}"`);
    this.onTranscriptCallback(text);
  }

  private handleUnexpectedClose(): void {
    if (
      !shouldReconnectDeepgram(this.intentionallyClosed, this.reconnectAttempts)
    ) {
      if (!this.intentionallyClosed && !this.restMode) {
        console.log("🎙️  Deepgram reconnect exhausted — switching to REST fallback");
        this.restMode = true;
        this.startRestLoop();
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
    this.muted = true;
    this.restBuffer = [];
  }

  unmuteInput(): void {
    this.muted = false;
    this.restBuffer = [];
  }

  sendAudio(chunk: Buffer): void {
    if (this.restMode) {
      if (!this.muted) this.restBuffer.push(chunk);
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

  onTranscript(callback: ((text: string) => void) | null): void {
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
    this.audioQueue = [];
    this.restBuffer = [];
    this.pendingUtterance = "";
    if (this.restTimer) { clearInterval(this.restTimer); this.restTimer = null; }
    if (this.connection) {
      try { this.connection.close(); } catch { /* ignore */ }
      this.connection = null;
    }
  }

  private startRestLoop(): void {
    if (this.restTimer) return;
    // Longer batch window so REST mode also waits for fuller phrases
    this.restTimer = setInterval(() => this.flushRestBuffer(), 4500);
  }

  private async flushRestBuffer(): Promise<void> {
    if (this.muted || this.restBuffer.length === 0) return;

    const chunks = this.restBuffer.splice(0);
    const raw = Buffer.concat(chunks);

    if (this.encoding === "linear16") {
      if (raw.length < this.sampleRate) return;
      try {
        const wav = pcm16ToWav(raw, this.sampleRate);
        const transcript = await this.transcribeWav(wav);
        if (transcript && this.onTranscriptCallback) this.onTranscriptCallback(transcript);
      } catch (err: any) {
        console.error("🎙️  Deepgram REST fetch error:", err.message);
      }
      return;
    }

    const mulaw  = raw;

    // ~0.75s of audio at 8kHz µ-law before bothering REST
    if (mulaw.length < 6000 || !hasVoice(mulaw)) return;

    try {
      const wav = mulawToWav(mulaw);
      const transcript = await this.transcribeWav(wav);
      if (transcript && transcript.split(/\s+/).length >= 2 && this.onTranscriptCallback) {
        console.log(`🎙️  Transcript (REST): "${transcript}"`);
        this.onTranscriptCallback(transcript);
      } else if (transcript) {
        console.log(`🎙️  Transcript too short, skipping: "${transcript}"`);
      }
    } catch (err: any) {
      console.error("🎙️  Deepgram REST fetch error:", err.message);
    }
  }

  private async transcribeWav(wav: Buffer): Promise<string> {
    const response = await fetch(
      `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(this.model)}&language=en-US`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${this.apiKey}`,
          "Content-Type": "audio/wav",
        },
        body: wav as any,
      }
    );
    if (!response.ok) {
      const err = await response.text();
      console.error("🎙️  Deepgram REST error:", err);
      return "";
    }
    const result = await response.json() as any;
    return result?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || "";
  }
}
