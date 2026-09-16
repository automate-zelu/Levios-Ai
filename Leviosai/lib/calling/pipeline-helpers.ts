// ─── CALLING PIPELINE HELPERS ────────────────────────────────────────────────
// Pure helpers for latency budgets, Deepgram reconnect policy, and TTS timeouts.
// Used by AudioPipeline / DeepgramSTTClient — unit-tested without network I/O.

/** Soft target for STT → LLM → TTS round trip (plan Week 5: <1.5s ideal). */
export const PIPELINE_LATENCY_WARN_MS = 1500;

/** Hard cap waiting on LLM response before aborting the turn. */
export const LLM_RESPONSE_TIMEOUT_MS = 12_000;

/** Hard cap waiting on ElevenLabs first-byte / stream completion. */
export const TTS_TIMEOUT_MS = 8_000;

/** Max Deepgram auto-reconnect attempts after unexpected close mid-call. */
export const DEEPGRAM_MAX_RECONNECTS = 2;

/** Delay before Deepgram reconnect attempt. */
export const DEEPGRAM_RECONNECT_DELAY_MS = 500;

/**
 * Silence gap (ms) after the lead's last final transcript fragment before we
 * treat the turn as complete and generate an AI reply. Prevents responding to
 * mid-sentence chunks like "could you" before "tell me more…".
 */
export const LEAD_TURN_GAP_MS = 1400;

/** Minimum words in a lead turn before we bother the LLM (skip filler/noise). */
export const LEAD_TURN_MIN_WORDS = 1;

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

export type PostCallOutcome = "booked" | "qualified" | "answered" | "no_answer" | "voicemail" | "failed";

/** Session outcome after hangup — greeting-only / voicemail is never "answered". */
export function resolvePostCallOutcome(opts: {
  transcript: string | null | undefined;
  analysedOutcome?: string | null;
  midCallBooking?: boolean;
}): PostCallOutcome {
  if (opts.midCallBooking) return "booked";
  if (!transcriptHasLeadSpeech(opts.transcript)) return "no_answer";
  const o = (opts.analysedOutcome || "answered") as PostCallOutcome;
  if (["booked", "qualified", "answered", "no_answer", "voicemail", "failed"].includes(o)) return o;
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
}): "sms_miss" | "sms_failed" | "busy_retry" | "sms_busy_max" | "booked" | "answered_exhausted" | "noop" {
  const status = (opts.callStatus || "").toLowerCase();
  if (status === "no-answer") return "sms_miss";
  if (status === "failed" || status === "canceled") return "sms_failed";
  if (status === "busy") {
    return (opts.callAttempts ?? 1) < 3 ? "busy_retry" : "sms_busy_max";
  }
  if (status === "completed") {
    const outcome = resolvePostCallOutcome({
      transcript: opts.transcript,
      analysedOutcome: opts.outcome,
    });
    if (outcome === "booked") return "booked";
    if (outcome === "qualified" || outcome === "answered") return "answered_exhausted";
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
