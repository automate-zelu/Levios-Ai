/**
 * OpenAI Realtime WebSocket client for Twilio Media Streams (G.711 μ-law).
 *
 * Single stack: speech-in → model → speech-out with server VAD + barge-in.
 * @see https://platform.openai.com/docs/guides/realtime
 */

import WebSocket from "ws";
import { CALL_TOOL_DEFINITIONS, executeCallTool, type CallToolContext } from "./call-calendar-tools.js";

export type RealtimeVoice =
  | "alloy"
  | "ash"
  | "ballad"
  | "coral"
  | "echo"
  | "sage"
  | "shimmer"
  | "verse"
  | "marin"
  | "cedar"
  | string;

export interface RealtimeSessionOpts {
  instructions: string;
  voice?: RealtimeVoice | string;
  enableCalendarTools?: boolean;
  toolContext?: CallToolContext;
  model?: string;
  onLeadTranscript?: (text: string) => void;
  onAiTranscript?: (text: string) => void;
  onAudioDelta?: (base64Pcmu: string) => void;
  /** Confirmed barge-in only (sustained user speech while assistant is talking). */
  onBargeIn?: () => void;
  onError?: (err: Error) => void;
  onReady?: () => void;
}

const DEFAULT_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";

/** Built-in OpenAI Realtime voices (all currently documented). */
export const OPENAI_REALTIME_VOICES: Array<{ id: string; name: string; note?: string }> = [
  { id: "marin", name: "Marin", note: "Recommended" },
  { id: "cedar", name: "Cedar", note: "Recommended" },
  { id: "alloy", name: "Alloy" },
  { id: "ash", name: "Ash" },
  { id: "ballad", name: "Ballad" },
  { id: "coral", name: "Coral" },
  { id: "echo", name: "Echo" },
  { id: "sage", name: "Sage" },
  { id: "shimmer", name: "Shimmer" },
  { id: "verse", name: "Verse" },
];

const BUILTIN_VOICE_IDS = new Set(OPENAI_REALTIME_VOICES.map((v) => v.id));

/** Ignore brief noise/echo; only treat as interruption after this much sustained speech. */
const BARGE_IN_CONFIRM_MS = 380;

export function useOpenAiRealtimeVoice(): boolean {
  const stack = (process.env.CALL_VOICE_STACK || "realtime").toLowerCase().trim();
  if (stack === "classic" || stack === "pipeline" || stack === "legacy") return false;
  if (stack === "realtime" || stack === "openai") {
    return Boolean(process.env.OPENAI_API_KEY);
  }
  return Boolean(process.env.OPENAI_API_KEY);
}

export function mapToRealtimeVoice(preferred?: string | null): string {
  const v = (preferred || process.env.OPENAI_REALTIME_VOICE || "marin").trim();
  if (!v) return "marin";
  const lower = v.toLowerCase();
  if (BUILTIN_VOICE_IDS.has(lower)) return lower;
  // Custom OpenAI voice ids (voice_…)
  if (/^voice_[a-zA-Z0-9_-]+$/.test(v)) return v;
  return "marin";
}

export class OpenAIRealtimeSession {
  private ws: WebSocket | null = null;
  private closed = false;
  private ready = false;
  private aiBuf = "";
  private opts: RealtimeSessionOpts;
  private pendingFnArgs = new Map<string, { name: string; args: string }>();
  private assistantSpeaking = false;
  private bargeTimer: ReturnType<typeof setTimeout> | null = null;
  private suppressOutbound = false;

  constructor(opts: RealtimeSessionOpts) {
    this.opts = opts;
  }

  get isReady(): boolean {
    return this.ready && !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  get isAssistantSpeaking(): boolean {
    return this.assistantSpeaking;
  }

  async connect(): Promise<void> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

    const model = this.opts.model || DEFAULT_MODEL;
    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          // GA Realtime no longer needs the beta header; keep harmless if ignored
        },
      });
      this.ws = ws;

      const timer = setTimeout(() => {
        reject(new Error("OpenAI Realtime open timeout"));
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }, 12_000);

      ws.on("open", () => {
        clearTimeout(timer);
        console.log(`🎙️  OpenAI Realtime connected model=${model}`);
        this.sendSessionUpdate();
        resolve();
      });

      ws.on("message", (raw) => {
        try {
          this.handleEvent(JSON.parse(raw.toString()));
        } catch (err: any) {
          console.warn("Realtime parse error:", err?.message || err);
        }
      });

      ws.on("error", (err) => {
        clearTimeout(timer);
        console.error("🎙️  OpenAI Realtime error:", err.message);
        this.opts.onError?.(err);
        reject(err);
      });

      ws.on("close", () => {
        this.ready = false;
        console.log("🎙️  OpenAI Realtime closed");
      });
    });
  }

  private sendSessionUpdate(): void {
    const voice = mapToRealtimeVoice(this.opts.voice);
    const tools =
      this.opts.enableCalendarTools && this.opts.toolContext
        ? CALL_TOOL_DEFINITIONS
        : [];

    // Prefer GA nested audio schema; also tolerated by recent realtime models.
    const session: Record<string, unknown> = {
      type: "realtime",
      instructions: this.opts.instructions,
      output_modalities: ["audio"],
      tools,
      tool_choice: tools.length ? "auto" : "none",
      audio: {
        input: {
          format: { type: "audio/pcmu" },
          transcription: { model: "gpt-4o-mini-transcribe" },
          turn_detection: {
            type: "server_vad",
            // Higher threshold reduces echo/noise cutting the agent mid-sentence
            threshold: 0.68,
            prefix_padding_ms: 280,
            silence_duration_ms: 650,
            create_response: true,
            interrupt_response: true,
          },
        },
        output: {
          format: { type: "audio/pcmu" },
          voice,
        },
      },
    };

    this.send({ type: "session.update", session });
  }

  /** Forward Twilio μ-law base64 payload straight to OpenAI. */
  appendAudioBase64(payloadB64: string): void {
    if (!this.isReady || !payloadB64) return;
    this.send({ type: "input_audio_buffer.append", audio: payloadB64 });
  }

  /** Ask the model to speak first (outbound greeting). */
  requestGreeting(): void {
    if (!this.isReady) return;
    this.send({
      type: "response.create",
      response: {
        instructions:
          "The outbound call just connected. Deliver a VERY short opening only: one sentence, max ~15 words. " +
          "State your name + company, that you are calling them, and ask if now is a good time. " +
          "Do NOT pitch services yet. Do NOT ask for name or phone — confirm from CRM only later if needed.",
      },
    });
  }

  cancelResponse(): void {
    if (!this.isReady) return;
    this.send({ type: "response.cancel" });
  }

  close(): void {
    this.closed = true;
    this.ready = false;
    this.clearBargeTimer();
    this.assistantSpeaking = false;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }

  private clearBargeTimer(): void {
    if (this.bargeTimer) {
      clearTimeout(this.bargeTimer);
      this.bargeTimer = null;
    }
  }

  /** Only clear Twilio / cancel after sustained user speech while we are talking. */
  private armBargeIn(): void {
    if (!this.assistantSpeaking) return;
    if (this.bargeTimer) return;
    this.bargeTimer = setTimeout(() => {
      this.bargeTimer = null;
      if (!this.assistantSpeaking || this.closed) return;
      console.log("🎙️  Confirmed barge-in — stopping assistant audio");
      this.suppressOutbound = true;
      this.assistantSpeaking = false;
      this.opts.onBargeIn?.();
    }, BARGE_IN_CONFIRM_MS);
  }

  private send(event: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(event));
  }

  private handleEvent(ev: any): void {
    if (!ev?.type || this.closed) return;
    const t = String(ev.type);

    if (t === "session.updated" || t === "session.created") {
      this.ready = true;
      this.opts.onReady?.();
      return;
    }

    if (t === "error") {
      const msg = ev.error?.message || ev.message || "Realtime error";
      console.error("🎙️  Realtime server error:", msg, ev.error?.code || "");
      this.opts.onError?.(new Error(msg));
      return;
    }

    // Possible interruption — confirm before cutting agent audio (avoid echo drops)
    if (t === "input_audio_buffer.speech_started") {
      this.armBargeIn();
      return;
    }

    if (t === "input_audio_buffer.speech_stopped") {
      // Brief blip / echo — cancel pending barge-in
      this.clearBargeTimer();
      return;
    }

    // Audio out (GA + legacy names)
    if (
      (t === "response.output_audio.delta" || t === "response.audio.delta") &&
      ev.delta
    ) {
      // Drop trailing chunks from an interrupted response; resume on next response.done→new turn
      if (this.suppressOutbound) return;
      this.assistantSpeaking = true;
      this.opts.onAudioDelta?.(ev.delta);
      return;
    }

    if (
      t === "response.output_audio.done" ||
      t === "response.audio.done" ||
      t === "response.done"
    ) {
      this.assistantSpeaking = false;
      this.clearBargeTimer();
      // Allow the next model turn to play after an interrupt
      if (t === "response.done") this.suppressOutbound = false;
      if (t !== "response.done") return;
    }

    // AI transcript
    if (
      t === "response.output_audio_transcript.delta" ||
      t === "response.audio_transcript.delta"
    ) {
      this.aiBuf += ev.delta || "";
      return;
    }
    if (
      t === "response.output_audio_transcript.done" ||
      t === "response.audio_transcript.done"
    ) {
      const text = (ev.transcript || this.aiBuf || "").trim();
      this.aiBuf = "";
      if (text) this.opts.onAiTranscript?.(text);
      return;
    }

    // Lead transcript (input transcription)
    if (
      t === "conversation.item.input_audio_transcription.completed" ||
      t === "conversation.item.input_audio_transcription.done"
    ) {
      const text = (ev.transcript || "").trim();
      if (text) this.opts.onLeadTranscript?.(text);
      return;
    }
    if (t === "session.input_transcript.done" || t === "session.input_transcript.delta") {
      if (t.endsWith(".done") && ev.transcript) {
        this.opts.onLeadTranscript?.(String(ev.transcript).trim());
      }
      return;
    }

    // Function calling
    if (t === "response.function_call_arguments.delta") {
      const id = ev.call_id || ev.item_id;
      if (!id) return;
      const cur = this.pendingFnArgs.get(id) || { name: ev.name || "", args: "" };
      if (ev.name) cur.name = ev.name;
      cur.args += ev.delta || "";
      this.pendingFnArgs.set(id, cur);
      return;
    }

    if (t === "response.function_call_arguments.done") {
      const id = ev.call_id || ev.item_id;
      const name = ev.name || this.pendingFnArgs.get(id || "")?.name || "";
      const argsStr = ev.arguments || this.pendingFnArgs.get(id || "")?.args || "{}";
      if (id) this.pendingFnArgs.delete(id);
      void this.runTool(id, name, argsStr);
      return;
    }

    if (t === "response.done" && Array.isArray(ev.response?.output)) {
      for (const item of ev.response.output) {
        if (item?.type === "function_call" && item.call_id) {
          void this.runTool(item.call_id, item.name, item.arguments || "{}");
        }
      }
    }
  }

  private async runTool(callId: string | undefined, name: string, argsStr: string): Promise<void> {
    if (!callId || !name || !this.opts.toolContext) return;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(argsStr || "{}");
    } catch {
      args = {};
    }
    console.log(`🔧 Realtime tool ${name}(${argsStr.substring(0, 120)})`);
    const output = await executeCallTool(name, args, this.opts.toolContext);
    this.send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output,
      },
    });
    this.send({ type: "response.create" });
  }
}
