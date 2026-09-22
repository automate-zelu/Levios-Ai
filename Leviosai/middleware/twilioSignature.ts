// ─── TWILIO WEBHOOK SIGNATURE VALIDATION ─────────────────────────────────────
// Validates the X-Twilio-Signature header on all inbound Twilio webhooks.
//
// Twilio signs every webhook with HMAC-SHA1 using the account's auth token.
// Requests without a valid signature return 403 — prevents spoofed webhooks.
//
// Multi-tenant BYOT handling:
//   - SMS / status webhooks: look up workspace by To/From phone → workspace auth token
//   - Call-session webhooks: resolve token via session → workspace
//   - Telnyx TeXML: session UUID gate (no Twilio HMAC) — resolver returns __TELNYX_SESSION__
//   - No platform TWILIO_* env fallback (every workspace brings its own Twilio)
//
// Validation is skipped in development (localhost) because Twilio signs against
// the public URL, which won't match a local URL.

import { Request, Response, NextFunction } from "express";
import twilio from "twilio";
import { db } from "../lib/db.js";
import { workspaces } from "../lib/schema.js";
import { eq } from "drizzle-orm";
import { decrypt } from "../lib/crypto.js";

const TELNYX_SESSION_TOKEN = "__TELNYX_SESSION__";

function isDev(): boolean {
  const base = process.env.BASE_URL ?? "";
  return (
    process.env.NODE_ENV !== "production" ||
    base.includes("localhost") ||
    base.includes("127.0.0.1")
  );
}

function digitsOf(phone: string): string {
  const d = (phone || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return d.length >= 10 ? d.slice(-10) : d;
}

async function resolveAuthTokenByPhone(toPhone: string): Promise<string | null> {
  const want = digitsOf(toPhone);
  if (!want) return null;
  try {
    const rows = await db
      .select({
        twilioSubAuthToken: workspaces.twilioSubAuthToken,
        twilioPhoneNumber: workspaces.twilioPhoneNumber,
      })
      .from(workspaces);

    const ws = rows.find((r) => digitsOf(r.twilioPhoneNumber || "") === want);
    if (ws?.twilioSubAuthToken) {
      return decrypt(ws.twilioSubAuthToken);
    }
  } catch {
    // Decryption / lookup failure — no platform env fallback
  }
  return null;
}

/** Resolve BYOT auth token from outbound From or inbound To. */
async function resolveAuthTokenByCallLegs(
  fromPhone: string,
  toPhone: string
): Promise<string | null> {
  return (
    (await resolveAuthTokenByPhone(fromPhone)) ||
    (await resolveAuthTokenByPhone(toPhone))
  );
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function candidateWebhookUrls(req: Request): string[] {
  const path = req.originalUrl || req.url || "";
  const pathNoQuery = path.split("?")[0];
  const base = (process.env.BASE_URL ?? "").replace(/\/$/, "");
  const rawProto = String(req.headers["x-forwarded-proto"] ?? req.protocol ?? "https");
  const proto = rawProto.split(",")[0].trim() || "https";
  const rawHost = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "");
  const host = rawHost.split(",")[0].trim();
  return uniqueNonEmpty([
    base ? `${base}${path}` : null,
    base ? `${base}${pathNoQuery}` : null,
    host ? `${proto}://${host}${path}` : null,
    host ? `${proto}://${host}${pathNoQuery}` : null,
    host ? `https://${host}${pathNoQuery}` : null,
  ]);
}

async function resolveAuthTokenBySession(sessionId: string): Promise<string | null> {
  try {
    const { sdrCallSessions } = await import("../lib/schema.js");
    const [session] = await db
      .select({ workspaceId: sdrCallSessions.workspaceId })
      .from(sdrCallSessions)
      .where(eq(sdrCallSessions.id, sessionId))
      .limit(1);

    if (!session) return null;

    const [ws] = await db
      .select({
        twilioSubAuthToken: workspaces.twilioSubAuthToken,
        voiceProvider: workspaces.voiceProvider,
        telnyxApiKey: workspaces.telnyxApiKey,
      })
      .from(workspaces)
      .where(eq(workspaces.id, session.workspaceId))
      .limit(1);

    // Telnyx TeXML callbacks are not Twilio-HMAC signed — session UUID is the gate.
    if (ws?.voiceProvider === "telnyx" || (ws?.telnyxApiKey && !ws?.twilioSubAuthToken)) {
      return TELNYX_SESSION_TOKEN;
    }

    if (ws?.twilioSubAuthToken) {
      return decrypt(ws.twilioSubAuthToken);
    }
  } catch {
    // no fallback
  }
  return null;
}

export function twilioSignatureMiddleware(
  resolver?: (req: Request) => Promise<string | null>
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (isDev()) {
      return next();
    }

    const urls = candidateWebhookUrls(req);
    const tokens = uniqueNonEmpty([resolver ? await resolver(req) : null]);

    if (tokens.length === 0) {
      console.warn("Twilio signature validation: no workspace auth token — rejecting");
      res.status(403).json({ error: "No workspace Twilio credentials for this webhook" });
      return;
    }

    const isTelnyxSession = tokens.includes(TELNYX_SESSION_TOKEN);
    const signature = req.headers["x-twilio-signature"] as string | undefined;

    // Telnyx TeXML / status callbacks omit Twilio HMAC — session UUID already verified.
    if (isTelnyxSession) {
      return next();
    }

    if (!signature) {
      res.status(403).json({ error: "Missing X-Twilio-Signature header" });
      return;
    }

    const body = req.body ?? {};
    let valid = false;
    for (const authToken of tokens) {
      for (const url of urls) {
        if (twilio.validateRequest(authToken, signature, url, body)) {
          valid = true;
          break;
        }
      }
      if (valid) break;
    }

    if (!valid) {
      console.warn(`Twilio signature validation FAILED for ${urls.join(" | ")}`);
      res.status(403).json({ error: "Invalid Twilio signature" });
      return;
    }

    next();
  };
}

/** For SMS webhooks — resolves token by `req.body.To` (workspace phone number). */
export const validateTwilioSms = twilioSignatureMiddleware(
  (req) => resolveAuthTokenByPhone(req.body?.To ?? "")
);

/** For call-session webhooks — resolves token by URL param `sessionId`. */
export const validateTwilioCallSession = twilioSignatureMiddleware(
  (req) => resolveAuthTokenBySession(req.params?.sessionId ?? "")
);

/** Call-status / voice webhooks — resolve BYOT token from From or To. */
export const validateTwilioGeneric = twilioSignatureMiddleware((req) =>
  resolveAuthTokenByCallLegs(req.body?.From ?? "", req.body?.To ?? "")
);
