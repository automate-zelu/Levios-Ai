// ─── TWILIO <Say> TTS FALLBACK ───────────────────────────────────────────────
// Plan §18: ElevenLabs API timeout — fallback: Twilio reads plain text, call continues.
//
// Mid-stream Media Streams cannot inject TwiML, so we redirect the live call:
//   <Say>…</Say> → <Connect><Stream/></Connect>
// The existing WebSocket closes; AudioPipeline suppresses endCall and resumes
// on the next stream connection for the same session.

import { db } from "../db.js";
import { sdrCallSessions, workspaces } from "../schema.js";
import { eq } from "drizzle-orm";
import { getClientForWorkspace } from "../twilio-subaccount.js";

/** Max characters Twilio <Say> handles reliably. */
export const TWILIO_SAY_MAX_CHARS = 3500;

/** Default Polly voice used when ElevenLabs is unavailable. */
export const TWILIO_SAY_VOICE = "Polly.Joanna" as const;

/** Sessions currently redirecting for <Say> fallback (skip endCall on WS close). */
const sayFallbackRedirects = new Map<string, NodeJS.Timeout>();

/** Live media-stream sockets per session (Say redirect can overlap old+new briefly). */
const activeStreamCounts = new Map<string, number>();

export function markSayFallbackRedirect(sessionId: string): void {
  const existing = sayFallbackRedirects.get(sessionId);
  if (existing) clearTimeout(existing);
  // If reconnect never arrives, drop the flag so a later hangup can finalize.
  const timer = setTimeout(() => {
    sayFallbackRedirects.delete(sessionId);
  }, 60_000);
  sayFallbackRedirects.set(sessionId, timer);
}

export function clearSayFallbackRedirect(sessionId: string): void {
  const existing = sayFallbackRedirects.get(sessionId);
  if (existing) clearTimeout(existing);
  sayFallbackRedirects.delete(sessionId);
}

export function isSayFallbackRedirect(sessionId: string): boolean {
  return sayFallbackRedirects.has(sessionId);
}

export function trackStreamOpen(sessionId: string): void {
  activeStreamCounts.set(sessionId, (activeStreamCounts.get(sessionId) ?? 0) + 1);
}

export function trackStreamClose(sessionId: string): number {
  const next = Math.max(0, (activeStreamCounts.get(sessionId) ?? 1) - 1);
  if (next === 0) activeStreamCounts.delete(sessionId);
  else activeStreamCounts.set(sessionId, next);
  return next;
}

export function getActiveStreamCount(sessionId: string): number {
  return activeStreamCounts.get(sessionId) ?? 0;
}

/**
 * True when WS close must not finalize the call because a Say redirect is pending.
 * Prefer combining with trackStreamClose()'s remaining count in the close handler.
 */
export function shouldSuppressEndOnStreamClose(sessionId: string): boolean {
  return isSayFallbackRedirect(sessionId);
}

export function escapeXmlForTwiml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function truncateForTwilioSay(text: string, max = TWILIO_SAY_MAX_CHARS): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Build TwiML: speak plain text via Twilio TTS, then reconnect the AI media stream.
 */
export function buildSayThenStreamTwiml(
  text: string,
  streamWssUrl: string,
  voice: string = TWILIO_SAY_VOICE
): string {
  const spoken = escapeXmlForTwiml(truncateForTwilioSay(text));
  const url = escapeXmlForTwiml(streamWssUrl);
  const voiceAttr = escapeXmlForTwiml(voice);

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Say voice="${voiceAttr}">${spoken}</Say>` +
    `<Connect>` +
    `<Stream url="${url}" track="inbound_track" />` +
    `</Connect>` +
    `</Response>`
  );
}

export function buildStreamWssUrl(baseUrl: string, sessionId: string): string {
  const host = new URL(baseUrl).hostname;
  return `wss://${host}/api/call/stream/${sessionId}`;
}

export interface PlaySayFallbackResult {
  ok: boolean;
  reason?: string;
  twiml?: string;
}

/**
 * Redirect a live Twilio call so Twilio <Say>s the AI text, then reconnects the stream.
 */
export async function playTextViaTwilioSay(
  sessionId: string,
  text: string
): Promise<PlaySayFallbackResult> {
  const spoken = truncateForTwilioSay(text);
  if (!spoken) {
    return { ok: false, reason: "empty_text" };
  }

  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) {
    return { ok: false, reason: "BASE_URL_missing" };
  }

  const [session] = await db
    .select()
    .from(sdrCallSessions)
    .where(eq(sdrCallSessions.id, sessionId))
    .limit(1);

  if (!session?.twilioCallSid) {
    return { ok: false, reason: "no_call_sid" };
  }

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, session.workspaceId))
    .limit(1);

  if (!workspace) {
    return { ok: false, reason: "workspace_not_found" };
  }

  const streamUrl = buildStreamWssUrl(baseUrl, sessionId);
  const twiml = buildSayThenStreamTwiml(spoken, streamUrl);

  try {
    const { client } = getClientForWorkspace(workspace);
    markSayFallbackRedirect(sessionId);
    await client.calls(session.twilioCallSid).update({ twiml });
    console.log(
      `🔊 Twilio <Say> fallback for session ${sessionId} call=${session.twilioCallSid} chars=${spoken.length}`
    );
    return { ok: true, twiml };
  } catch (err: any) {
    clearSayFallbackRedirect(sessionId);
    console.error(
      `Twilio <Say> fallback failed for session ${sessionId}:`,
      err?.message || err
    );
    return { ok: false, reason: err?.message || "twilio_update_failed" };
  }
}
