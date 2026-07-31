// ─── Gmail BYOT routes — connect user's Gmail to send SDR emails ─────────────

import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { requireAuth } from "./auth.js";
import {
  buildGmailAuthorizeUrl,
  exchangeGmailAuthorizationCode,
  frontendGmailReturnUrl,
  getGoogleOAuthCredentials,
  GMAIL_OAUTH_SCOPES,
} from "../lib/gmail/oauth.js";
import {
  deleteGmailConnection,
  getGmailStatus,
  upsertGmailConnection,
} from "../lib/gmail/tokens.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "catalyst-dev-secret-change-in-production";

interface OAuthStatePayload {
  organizationId: number;
  userId: number;
  purpose: "gmail";
}

function signOAuthState(payload: OAuthStatePayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "15m" });
}

function verifyOAuthState(state: string): OAuthStatePayload {
  const decoded = jwt.verify(state, JWT_SECRET) as OAuthStatePayload;
  if (!decoded?.organizationId || decoded.purpose !== "gmail") {
    throw new Error("Invalid OAuth state");
  }
  return decoded;
}

// GET /api/gmail/status
router.get("/api/gmail/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = req.organizationId;
    if (!orgId) return res.status(400).json({ error: "No organization" });
    res.json(await getGmailStatus(orgId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/gmail/oauth/start → { url }
router.post("/api/gmail/oauth/start", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = req.organizationId;
    const userId = req.userId;
    if (!orgId || !userId) return res.status(400).json({ error: "No organization" });

    const creds = getGoogleOAuthCredentials();
    if (!creds.configured) {
      return res.status(503).json({
        error: "Gmail sign-in is temporarily unavailable. Ask your admin to configure Google OAuth.",
      });
    }

    const state = signOAuthState({ organizationId: orgId, userId, purpose: "gmail" });
    const url = buildGmailAuthorizeUrl(state);
    res.json({ url });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/gmail/oauth/callback
router.get("/api/gmail/oauth/callback", async (req: Request, res: Response) => {
  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  const oauthError = typeof req.query.error === "string" ? req.query.error : null;

  if (oauthError) {
    return res.redirect(frontendGmailReturnUrl({ gmail: "error", reason: oauthError }));
  }
  if (!code || !state) {
    return res.redirect(frontendGmailReturnUrl({ gmail: "error", reason: "missing_code" }));
  }

  try {
    const payload = verifyOAuthState(state);
    const tokens = await exchangeGmailAuthorizationCode(code);
    if (!tokens.refreshToken) {
      // Still store access token; warn via query that re-consent may be needed later
      console.warn("Gmail OAuth: no refresh_token returned — user may need to revoke and reconnect");
    }
    await upsertGmailConnection({
      organizationId: payload.organizationId,
      accountEmail: tokens.accountEmail,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
      scopes: GMAIL_OAUTH_SCOPES,
    });
    return res.redirect(
      frontendGmailReturnUrl({
        gmail: "connected",
        email: tokens.accountEmail || "",
      })
    );
  } catch (err: any) {
    console.error("Gmail OAuth callback error:", err.message);
    return res.redirect(
      frontendGmailReturnUrl({
        gmail: "error",
        reason: encodeURIComponent(err.message || "oauth_failed"),
      })
    );
  }
});

// DELETE /api/gmail/connect
router.delete("/api/gmail/connect", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = req.organizationId;
    if (!orgId) return res.status(400).json({ error: "No organization" });
    await deleteGmailConnection(orgId);
    res.json({ connected: false });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
