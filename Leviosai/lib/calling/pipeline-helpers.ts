// ─── CALLING PIPELINE HELPERS ────────────────────────────────────────────────
// Pure helpers for latency budgets, Deepgram reconnect policy, and TTS timeouts.
// Used by AudioPipeline / DeepgramSTTClient — unit-tested without network I/O.

/** Soft target for STT → LLM → TTS round trip (plan Week 5: <1.5s ideal). */
export const PIPELINE_LATENCY_WARN_MS = 1500;

/** Hard cap waiting on LLM response before aborting the turn. */
export const LLM_RESPONSE_TIMEOUT_MS = 12_000;

/** Hard cap waiting on ElevenLabs synthesis completion. */
export const TTS_TIMEOUT_MS = 12_000;

/** μ-law @ 8kHz frame size Twilio expects (~20ms). */
export const TWILIO_MULAW_FRAME_BYTES = 160;

/** Pace outbound media frames to Twilio (ms). */
export const TWILIO_MEDIA_FRAME_MS = 20;

/** Re-prompt if the lead never speaks after the greeting. */
export const GREETING_SILENCE_REPROMPT_MS = 8_000;

/** Max Deepgram auto-reconnect attempts after unexpected close mid-call. */
export const DEEPGRAM_MAX_RECONNECTS = 2;

/** Delay before Deepgram reconnect attempt. */
export const DEEPGRAM_RECONNECT_DELAY_MS = 500;

/**
 * Silence gap (ms) after the lead's last final transcript fragment before we
 * treat the turn as complete. Prefer turnHoldMs() from turn-gate.ts — these
 * constants remain for tests / REST batch sizing.
 */
export const LEAD_TURN_GAP_MS = 180;

/** Extra wait when the last fragment looks unfinished. */
export const LEAD_TURN_INCOMPLETE_GAP_MS = 700;

/** Minimum words in a lead turn before we bother the LLM (skip filler/noise). */
export const LEAD_TURN_MIN_WORDS = 1;

/** Deepgram REST batch interval when WSS is unavailable. */
export const DEEPGRAM_REST_FLUSH_MS = 900;

/** @deprecated use REST_TURN_HOLD_MS via turn-gate */
export const DEEPGRAM_REST_TURN_HOLD_MS = 1400;

/** @deprecated use REST_SHORT_ANSWER_HOLD_MS via turn-gate */
export const DEEPGRAM_REST_SHORT_ANSWER_HOLD_MS = 500;

export {
  looksLikeIncompleteUtterance,
  looksLikeCompleteShortAnswer,
  turnHoldMs,
  normalizeUtterance,
  type SttSource,
} from "./turn-gate.js";

import { turnHoldMs } from "./turn-gate.js";

/** @deprecated prefer turnHoldMs(text, source) */
export function leadTurnGapMs(text: string): number {
  return turnHoldMs(text, "rest");
}

/**
 * Whether a REST-batch Deepgram transcript should be emitted to the call agent.
 * Accept single-word answers ("yes", "hello", "sure") — those are valid turns.
 * Blank / punctuation-only strings are rejected.
 */
export function shouldAcceptRestTranscript(
  text: string,
  minWords = LEAD_TURN_MIN_WORDS
): boolean {
  const cleaned = (text || "").trim().replace(/[^\w\s']/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return false;
  return countWords(cleaned) >= minWords;
}

/**
 * Hold short/noisy REST fragments across batches so "yes" + "please" become one turn
 * when consecutive batches each only catch part of the phrase.
 */
export function accumulateRestTranscript(existing: string, next: string): string {
  return mergeUtteranceFragments(existing, next);
}

export interface LatencySample {
  llmMs: number;
  ttsMs: number;
  totalMs: number;
  overBudget: boolean;
}

export function measureLatency(llmStartedAt: number, ttsStartedAt: number, endedAt = Date.now()): LatencySample {
  const llmMs = Math.max(0, ttsStartedAt - llmStartedAt);
  const ttsMs = Math.max(0, endedAt - ttsStartedAt);
  const totalMs = Math.max(0, endedAt - llmStartedAt);
  return {
    llmMs,
    ttsMs,
    totalMs,
    overBudget: totalMs > PIPELINE_LATENCY_WARN_MS,
  };
}

/** Whether Deepgram should attempt another reconnect after an unexpected close. */
export function shouldReconnectDeepgram(
  intentionallyClosed: boolean,
  reconnectAttempts: number,
  maxReconnects = DEEPGRAM_MAX_RECONNECTS
): boolean {
  if (intentionallyClosed) return false;
  return reconnectAttempts < maxReconnects;
}

/**
 * Race a promise against a timeout. On timeout, rejects with a labeled Error
 * so callers can fall back (e.g. Twilio <Say>) without hanging the call.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Merge successive STT fragments into one lead turn.
 * Handles revisions (next supersedes prior) and simple appends.
 */
export function mergeUtteranceFragments(existing: string, next: string): string {
  const a = (existing || "").trim().replace(/\s+/g, " ");
  const b = (next || "").trim().replace(/\s+/g, " ");
  if (!a) return b;
  if (!b) return a;

  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (bl.startsWith(al)) return b;
  if (al.startsWith(bl)) return a;
  // Overlap at the join (e.g. "could you" + "you tell me")
  const aWords = a.split(" ");
  for (let n = Math.min(aWords.length, b.split(" ").length); n > 0; n--) {
    const tail = aWords.slice(-n).join(" ").toLowerCase();
    if (bl.startsWith(tail)) {
      return `${aWords.slice(0, -n).join(" ")} ${b}`.trim().replace(/\s+/g, " ");
    }
  }
  return `${a} ${b}`.replace(/\s+/g, " ").trim();
}

export function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export type PostCallOutcome =
  | "booked"
  | "qualified"
  | "answered"
  | "no_answer"
  | "no_response"
  | "voicemail"
  | "failed";

/**
 * Session outcome after hangup.
 * - Ring-out / never connected → no_answer
 * - Media connected but lead never spoke → no_response (picked up, silent)
 * - Lead spoke → analysed outcome (answered / booked / …)
 */
export function resolvePostCallOutcome(opts: {
  transcript: string | null | undefined;
  analysedOutcome?: string | null;
  midCallBooking?: boolean;
  /** True when Twilio media stream ran or the call had live connected time. */
  callConnected?: boolean;
}): PostCallOutcome {
  if (opts.midCallBooking) return "booked";
  if (!transcriptHasLeadSpeech(opts.transcript)) {
    return opts.callConnected ? "no_response" : "no_answer";
  }
  const o = (opts.analysedOutcome || "answered") as PostCallOutcome;
  if (
    ["booked", "qualified", "answered", "no_answer", "no_response", "voicemail", "failed"].includes(o)
  ) {
    return o;
  }
  return "answered";
}

/**
 * Twilio status callback → SDR sequence action. No I/O.
 */
export function resolveTwilioHangupAction(opts: {
  callStatus: string;
  outcome?: string | null;
  transcript?: string | null;
  callAttempts?: number;
  callConnected?: boolean;
}): "sms_miss" | "sms_failed" | "busy_retry" | "sms_busy_max" | "booked" | "answered_exhausted" | "noop" {
  const status = (opts.callStatus || "").toLowerCase();
  if (status === "no-answer") return "sms_miss";
  if (status === "failed" || status === "canceled") return "sms_failed";
  if (status === "busy") {
    return (opts.callAttempts ?? 1) < 3 ? "busy_retry" : "sms_busy_max";
  }
  if (status === "completed") {
    const connected =
      opts.callConnected ??
      (Boolean(opts.transcript?.trim()) || (opts.outcome !== "no_answer" && opts.outcome != null));
    const outcome = resolvePostCallOutcome({
      transcript: opts.transcript,
      analysedOutcome: opts.outcome,
      callConnected: connected,
    });
    if (outcome === "booked") return "booked";
    if (outcome === "qualified" || outcome === "answered") return "answered_exhausted";
    // no_answer / no_response / voicemail → continue sequence with SMS
    return "sms_miss";
  }
  return "noop";
}

/**
 * True only if the lead actually spoke. Twilio "answered" includes voicemail,
 * and the AI greeting alone must not count as a live conversation.
 */
export function transcriptHasLeadSpeech(transcript: string | null | undefined): boolean {
  if (!transcript?.trim()) return false;
  const t = transcript.trim();
  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      const parsed = JSON.parse(t);
      const lines = Array.isArray(parsed) ? parsed : parsed?.lines;
      if (Array.isArray(lines)) {
        return lines.some(
          (l: { speaker?: string; role?: string; text?: string }) =>
            (l.speaker === "lead" || l.role === "lead") && Boolean(String(l.text || "").trim())
        );
      }
    } catch {
      /* plain-text transcript */
    }
  }
  return /(?:^|\n)LEAD\s*:/i.test(t);
}

/** Keep the first spoken greeting short even if the model over-talks. */
export function shortenGreeting(text: string, maxWords = 18): string {
  const cleaned = (text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "Hi, this is Levios — is now a good time for a quick call?";
  }
  const sentence = cleaned.split(/(?<=[.!?])\s+/)[0]?.trim() || cleaned;
  const words = sentence.split(/\s+/);
  if (words.length <= maxWords) {
    return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
  }
  return `${words.slice(0, maxWords).join(" ").replace(/[,:;–—-]+$/, "")}.`;
}
