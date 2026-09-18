/**
 * Production turn-taking for live calls.
 *
 * Live (Deepgram WSS) already emits on acoustic utterance-end — only a tiny
 * merge window is needed. REST fallback needs longer holds because audio is
 * batch-cut. Text heuristics only extend the wait; they never shorten below
 * the acoustic floor for short answers.
 */

export type SttSource = "live" | "rest";

/** Merge window after a live UtteranceEnd (late fragments). */
export const LIVE_TURN_MERGE_MS = 180;

/** Extra wait on live when text still looks mid-thought. */
export const LIVE_INCOMPLETE_HOLD_MS = 700;

/** REST: wait after last words when utterance looks complete. */
export const REST_TURN_HOLD_MS = 1400;

/** REST: wait longer when utterance looks unfinished. */
export const REST_INCOMPLETE_HOLD_MS = 2800;

/** REST: snappy yes/no only when the ENTIRE transcript is a short answer. */
export const REST_SHORT_ANSWER_HOLD_MS = 500;

const SHORT_ANSWER_ONLY =
  /^(yes|yeah|yep|yup|no|nope|nah|sure|ok|okay|alright|correct|please|hello|hi|hey)[.!?]?$/i;

const TRAILING_INCOMPLETE =
  /\b(i am|i'm|i'm from|i am from|yes i am|yes i|my name is|my address is|address is|phone (number|is)|number is|it is|it's|and the|and my|from|in|at|on|near|around|to|for|with|of|about|um|uh|so|but|because|the|a|an|my|our|is|and|or|it|this|that|name|phone|address|number|system|problem|having)$/i;

/** Strip trailing punctuation so "My system." is not treated as finished. */
export function normalizeUtterance(text: string): string {
  return (text || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?…]+$/g, "")
    .trim();
}

export function looksLikeCompleteShortAnswer(text: string): boolean {
  const t = (text || "").trim().toLowerCase().replace(/\s+/g, " ");
  return SHORT_ANSWER_ONLY.test(t);
}

/**
 * True when the lead likely has not finished speaking.
 * Never treat a leading "Yes." inside a longer phrase as a complete answer.
 */
export function looksLikeIncompleteUtterance(text: string): boolean {
  const raw = (text || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!raw) return true;
  if (SHORT_ANSWER_ONLY.test(raw)) return false;

  const bare = normalizeUtterance(raw);
  if (!bare) return true;
  if (SHORT_ANSWER_ONLY.test(bare)) return false;
  if (TRAILING_INCOMPLETE.test(bare)) return true;

  const words = bare.split(/\s+/).filter(Boolean);
  // 1–2 word non-answers are usually mid-dictation
  if (words.length <= 2) return true;
  // Clause after a period that is still short ("… My system")
  const lastClause = bare.split(/[.!?]+/).pop()?.trim() || bare;
  if (lastClause.split(/\s+/).length <= 3 && TRAILING_INCOMPLETE.test(lastClause)) return true;
  if (/^(my|the|a|an|i|i'm|and)\b/i.test(lastClause) && lastClause.split(/\s+/).length <= 4) {
    return true;
  }
  return false;
}

/** How long to wait after the latest STT fragment before flushing to the LLM. */
export function turnHoldMs(text: string, source: SttSource = "live"): number {
  const incomplete = looksLikeIncompleteUtterance(text);
  if (source === "live") {
    return incomplete ? LIVE_INCOMPLETE_HOLD_MS : LIVE_TURN_MERGE_MS;
  }
  if (looksLikeCompleteShortAnswer(text) && !incomplete) {
    return REST_SHORT_ANSWER_HOLD_MS;
  }
  return incomplete ? REST_INCOMPLETE_HOLD_MS : REST_TURN_HOLD_MS;
}
