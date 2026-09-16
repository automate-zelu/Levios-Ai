// ─── TWILIO WEBHOOK SIGNATURE VALIDATION ─────────────────────────────────────
// Validates the X-Twilio-Signature header on all inbound Twilio webhooks.
//
// Twilio signs every webhook with HMAC-SHA1 using the account's auth token.
// Requests without a valid signature return 403 — prevents spoofed webhooks.
//
// Multi-tenant BYOT handling:
//   - SMS webhooks: look up workspace by the `To` phone number in the body
//   - Call-session webhooks: caller passes `authToken` directly (resolved at route level)
//   - Falls back to TWILIO_AUTH_TOKEN env var if workspace token not found
//
// Validation is skipped in development (localhost) because Twilio signs against
// the public URL, which won't match a local URL.

import { Request, Response, NextFunction } from "express";
import twilio from "twilio";
import { db } from "../lib/db.js";
import { workspaces } from "../lib/schema.js";
import { eq } from "drizzle-orm";
import { decrypt } from "../lib/crypto.js";

// ─── SKIP IN DEVELOPMENT ──────────────────────────────────────────────────────
// Twilio signs against the publicly accessible URL. During local dev the
// signature won't match, so we skip validation to avoid blocking all webhooks.

function isDev(): boolean {
  const base = process.env.BASE_URL ?? "";
  return (
    process.env.NODE_ENV !== "production" ||
    base.includes("localhost") ||
    base.includes("127.0.0.1")
  );
}

// ─── RESOLVE AUTH TOKEN BY WORKSPACE PHONE NUMBER ────────────────────────────
// SMS webhooks carry the destination phone number in `To`. We use it to find
// the workspace and get their (decrypted) Twilio auth token.

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
    // Decryption failure — fall back to env var token
  }
  return null;
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

// ─── RESOLVE AUTH TOKEN BY CALL SESSION ──────────────────────────────────────
// Call-status / recording webhooks carry the session ID in the URL.
// We look up the session → workspace → auth token.

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
      .select({ twilioSubAuthToken: workspaces.twilioSubAuthToken })
      .from(workspaces)
      .where(eq(workspaces.id, session.workspaceId))
      .limit(1);

    if (ws?.twilioSubAuthToken) {
      return decrypt(ws.twilioSubAuthToken);
    }
  } catch {
    // Fall back to env var
  }
  return null;
}

// ─── MIDDLEWARE FACTORY ───────────────────────────────────────────────────────
// `resolver` is an async fn(req) → authToken | null.
// If null is returned we fall back to the env var token, then validate.
// If no token is found at all, validation is skipped with a warning.

export function twilioSignatureMiddleware(
  resolver?: (req: Request) => Promise<string | null>
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (isDev()) {
      return next(); // Skip in development
    }

    const signature = req.headers["x-twilio-signature"] as string | undefined;
    if (!signature) {
      res.status(403).json({ error: "Missing X-Twilio-Signature header" });
      return;
    }

    const urls = candidateWebhookUrls(req);

    const tokens = uniqueNonEmpty([
      resolver ? await resolver(req) : null,
      process.env.TWILIO_AUTH_TOKEN,
      process.env.TWILIO_MASTER_AUTH_TOKEN,
    ]);

    if (tokens.length === 0) {
      console.warn("Twilio signature validation: no auth token available — skipping");
      return next();
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

// ─── NAMED PRESETS ────────────────────────────────────────────────────────────

/** For SMS webhooks — resolves token by `req.body.To` (workspace phone number). */
export const validateTwilioSms = twilioSignatureMiddleware(
  (req) => resolveAuthTokenByPhone(req.body?.To ?? "")
);

/** For call-session webhooks — resolves token by URL param `sessionId`. */
export const validateTwilioCallSession = twilioSignatureMiddleware(
  (req) => resolveAuthTokenBySession(req.params?.sessionId ?? "")
);

/** Generic validator using env var token only (for routes without workspace context). */
export const validateTwilioGeneric = twilioSignatureMiddleware();
