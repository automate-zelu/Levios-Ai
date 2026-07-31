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
