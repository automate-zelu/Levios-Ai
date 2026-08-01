// ─── Calendar OAuth + booking routes (Module 10) ─────────────────────────────

import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { requireAuth } from "./auth.js";
import {
  buildAuthorizeUrl,
  frontendCalendarReturnUrl,
  getProviderClientCredentials,
  parseProviderParam,
  GOOGLE_SCOPES,
  MICROSOFT_SCOPES,
  isCalendarProviderEnabled,
} from "../lib/calendar/oauth-config.js";
import { canSelectActiveProvider } from "../lib/calendar/booking-helpers.js";
import { exchangeAuthorizationCode } from "../lib/calendar/providers.js";
import {
  deleteCalendarConnection,
  listCalendarConnections,
  updateSelectedCalendar,
  upsertCalendarConnection,
} from "../lib/calendar/tokens.js";
import {
  getCalendarStatus,
  listCalendarsForOrg,
  setActiveCalendarProvider,
  getCalendarAvailability,
} from "../lib/calendar/service.js";
import type { CalendarProvider } from "../lib/calendar/types.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "catalyst-dev-secret-change-in-production";

interface OAuthStatePayload {
  organizationId: number;
  userId: number;
  provider: CalendarProvider;
  exp?: number;
}

function signOAuthState(payload: OAuthStatePayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "15m" });
}

function verifyOAuthState(state: string): OAuthStatePayload {
  const decoded = jwt.verify(state, JWT_SECRET) as OAuthStatePayload;
  if (!decoded?.organizationId || !decoded?.provider) {
    throw new Error("Invalid OAuth state");
  }
  return decoded;
}

// GET /api/calendar/status
router.get("/api/calendar/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = req.organizationId;
    if (!orgId) return res.status(400).json({ error: "No organization" });
    const status = await getCalendarStatus(orgId);
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calendar/oauth/:provider/start → { url }
router.post("/api/calendar/oauth/:provider/start", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = req.organizationId;
    const userId = req.userId;
    if (!orgId || !userId) return res.status(400).json({ error: "No organization" });

    const provider = parseProviderParam(req.params.provider);
    if (!provider) return res.status(400).json({ error: "provider must be google or outlook" });
    if (!isCalendarProviderEnabled(provider)) {
      return res.status(503).json({
        error: "Outlook calendar connect is not available yet. Please use Google Calendar.",
      });
    }

    const creds = getProviderClientCredentials(provider);
    if (!creds.configured) {
      // Platform OAuth app missing — user-facing copy stays simple (n8n-style Connect UX)
      return res.status(503).json({
        error: "Calendar sign-in is temporarily unavailable. Please try again later.",
      });
    }

    const state = signOAuthState({ organizationId: orgId, userId, provider });
    const url = buildAuthorizeUrl(provider, state);
    res.json({ url, provider });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/calendar/oauth/:provider/callback — browser redirect from Google/MS
router.get("/api/calendar/oauth/:provider/callback", async (req: Request, res: Response) => {
  const provider = parseProviderParam(req.params.provider);
  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  const oauthError = typeof req.query.error === "string" ? req.query.error : null;

  if (!provider) {
    return res.redirect(frontendCalendarReturnUrl({ calendar: "error", reason: "bad_provider" }));
  }
  if (oauthError) {
    return res.redirect(
      frontendCalendarReturnUrl({ calendar: "error", reason: oauthError })
    );
  }
  if (!code || !state) {
    return res.redirect(
      frontendCalendarReturnUrl({ calendar: "error", reason: "missing_code" })
    );
  }

  try {
    const payload = verifyOAuthState(state);
    if (payload.provider !== provider) {
      throw new Error("Provider mismatch in OAuth state");
    }

    const tokens = await exchangeAuthorizationCode(provider, code);
    await upsertCalendarConnection({
      organizationId: payload.organizationId,
      provider,
      accountEmail: tokens.accountEmail,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
      calendarId: "primary",
      scopes: provider === "google" ? GOOGLE_SCOPES : MICROSOFT_SCOPES,
    });

    const all = await listCalendarConnections(payload.organizationId);
    if (all.length === 1) {
      await setActiveCalendarProvider(payload.organizationId, provider);
    }

    return res.redirect(
      frontendCalendarReturnUrl({
        calendar: "connected",
        provider,
      })
    );
  } catch (err: any) {
    console.error("Calendar OAuth callback error:", err.message);
    return res.redirect(
      frontendCalendarReturnUrl({
        calendar: "error",
        reason: encodeURIComponent(err.message || "oauth_failed"),
      })
    );
  }
});

// POST /api/calendar/active  { provider: "google"|"outlook"|null }
router.post("/api/calendar/active", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = req.organizationId;
    if (!orgId) return res.status(400).json({ error: "No organization" });

    const raw = req.body?.provider;
    const provider = raw === null || raw === "" ? null : parseProviderParam(String(raw));
    if (raw != null && raw !== "" && !provider) {
      return res.status(400).json({ error: "provider must be google, outlook, or null" });
    }
    if (provider && !isCalendarProviderEnabled(provider)) {
      return res.status(400).json({
        error: "Outlook calendar is not available yet. Please use Google Calendar.",
      });
    }

    const connections = await listCalendarConnections(orgId);
    const connected = connections.map((c) => c.provider);
    if (!canSelectActiveProvider(provider, connected)) {
      return res.status(400).json({ error: "Connect that calendar before selecting it" });
    }

    const active = await setActiveCalendarProvider(orgId, provider);
    res.json({ ok: true, activeProvider: active });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/calendar/connect/:provider
router.delete("/api/calendar/connect/:provider", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = req.organizationId;
    if (!orgId) return res.status(400).json({ error: "No organization" });
    const provider = parseProviderParam(req.params.provider);
    if (!provider) return res.status(400).json({ error: "Invalid provider" });

    const before = await getCalendarStatus(orgId);
    const removed = await deleteCalendarConnection(orgId, provider);
    if (!removed) return res.status(404).json({ error: "Not connected" });

    if (before.activeProvider === provider) {
      const next =
        before.connections.find((c) => c.provider !== provider)?.provider ?? null;
      await setActiveCalendarProvider(orgId, next);
    }

    const status = await getCalendarStatus(orgId);
    res.json({ ok: true, ...status });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/calendar/calendars?provider=google
router.get("/api/calendar/calendars", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = req.organizationId;
    if (!orgId) return res.status(400).json({ error: "No organization" });
    const provider = parseProviderParam(
      typeof req.query.provider === "string" ? req.query.provider : undefined
    );
    const result = await listCalendarsForOrg(orgId, provider);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/calendar/calendars  { provider, calendarId }
router.patch("/api/calendar/calendars", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = req.organizationId;
    if (!orgId) return res.status(400).json({ error: "No organization" });
    const provider = parseProviderParam(req.body?.provider);
    const calendarId = String(req.body?.calendarId || "").trim();
    if (!provider || !calendarId) {
      return res.status(400).json({ error: "provider and calendarId required" });
    }
    const updated = await updateSelectedCalendar(orgId, provider, calendarId);
    if (!updated) return res.status(404).json({ error: "Not connected" });
    res.json({
      ok: true,
      provider: updated.provider,
      calendarId: updated.calendarId,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calendar/availability  { daysAhead?, durationMinutes?, timezone?, maxSlots? }
router.post("/api/calendar/availability", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = req.organizationId;
    if (!orgId) return res.status(400).json({ error: "No organization" });

    const result = await getCalendarAvailability({
      organizationId: orgId,
      daysAhead: req.body?.daysAhead != null ? Number(req.body.daysAhead) : undefined,
      durationMinutes:
        req.body?.durationMinutes != null ? Number(req.body.durationMinutes) : undefined,
      maxSlots: req.body?.maxSlots != null ? Number(req.body.maxSlots) : undefined,
      timezone: typeof req.body?.timezone === "string" ? req.body.timezone : undefined,
      timeMin: req.body?.timeMin ? new Date(req.body.timeMin) : undefined,
      timeMax: req.body?.timeMax ? new Date(req.body.timeMax) : undefined,
    });

    if (result.error && !result.connected) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
