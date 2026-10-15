/**
 * P5 — Integration API for Anthony’s external onboarding app.
 *
 * Auth: header X-Onboarding-Api-Key: <ONBOARDING_APP_API_KEY>
 * Public: POST /api/integrations/onboarding/exchange (one-time handoff code)
 */

import { Router, Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../lib/db.js";
import { users, organizations } from "../lib/schema.js";
import { ensureOrgSdr } from "../lib/org-tenant.js";
import {
  normalizeProvisionInput,
  buildHandoffClaims,
  parseHandoffClaims,
  buildHandoffLandingUrl,
  createJtiStore,
  timingSafeEqualString,
  DEFAULT_HANDOFF_TTL_SECONDS,
  HANDOFF_PURPOSE,
  type OnboardingPath,
} from "../lib/onboarding-handoff.js";
import { emitOnboardingAppWebhook } from "../lib/onboarding-webhooks.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "catalyst-dev-secret-change-in-production";
const jtiStore = createJtiStore();

function requireOnboardingApiKey(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.ONBOARDING_APP_API_KEY?.trim();
  if (!expected) {
    return res.status(503).json({
      error: "Onboarding integration disabled — set ONBOARDING_APP_API_KEY",
    });
  }
  const provided =
    (typeof req.headers["x-onboarding-api-key"] === "string"
      ? req.headers["x-onboarding-api-key"]
      : "") ||
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : "");
  if (!provided || !timingSafeEqualString(provided, expected)) {
    return res.status(401).json({ error: "Invalid onboarding API key" });
  }
  next();
}

function sessionTokenFor(user: {
  id: number;
  email: string;
  role: string | null;
  organizationId: number | null;
}, sdr: { workspaceId: string; tier: string }) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      workspaceId: sdr.workspaceId,
      tier: sdr.tier,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function mintHandoffCode(claims: ReturnType<typeof buildHandoffClaims>): string {
  return jwt.sign(claims, JWT_SECRET, {
    expiresIn: DEFAULT_HANDOFF_TTL_SECONDS,
  });
}

function appOrigin(req: Request): string {
  const env = process.env.APP_ORIGIN || process.env.PUBLIC_APP_URL;
  if (env) return env.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

/**
 * POST /api/integrations/onboarding/provision
 * Create or link org + user + workspace. Idempotent by email (and optional idempotencyKey).
 */
router.post(
  "/api/integrations/onboarding/provision",
  requireOnboardingApiKey,
  async (req: Request, res: Response) => {
    try {
      const parsed = normalizeProvisionInput(req.body);
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });
      const input = parsed.value;

      const [existingUser] = await db.select().from(users).where(eq(users.email, input.email));

      if (existingUser) {
        if (!existingUser.organizationId) {
          return res.status(409).json({
            error: "User exists without organization — resolve manually",
            email: existingUser.email,
          });
        }
        const sdr = await ensureOrgSdr(existingUser.organizationId);
        const path: OnboardingPath = input.path;
        const handoffClaims = buildHandoffClaims({
          jti: randomUUID(),
          userId: existingUser.id,
          organizationId: existingUser.organizationId,
          workspaceId: sdr.workspaceId,
          email: existingUser.email,
          path,
          prefill: input.prefill,
        });
        const code = mintHandoffCode(handoffClaims);
        const handoffUrl = buildHandoffLandingUrl(appOrigin(req), code);

        return res.status(200).json({
          created: false,
          idempotent: true,
          organizationId: existingUser.organizationId,
          workspaceId: sdr.workspaceId,
          userId: existingUser.id,
          email: existingUser.email,
          onboardingComplete: existingUser.onboardingComplete ?? true,
          path,
          handoffCode: code,
          handoffUrl,
          handoffExpiresInSeconds: DEFAULT_HANDOFF_TTL_SECONDS,
          temporaryPassword: undefined,
        });
      }

      const [org] = await db
        .insert(organizations)
        .values({
          name: input.organizationName,
          industry: input.industry,
        })
        .returning();

      const tempPassword =
        input.password || `Onboard-${randomUUID().replace(/-/g, "").slice(0, 10)}!`;
      const passwordHash = await bcrypt.hash(tempPassword, 12);

      const [user] = await db
        .insert(users)
        .values({
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          organizationId: org.id,
          onboardingComplete: false,
        })
        .returning();

      const sdr = await ensureOrgSdr(org.id);

      // Best-effort: stash external ref in settings if available later; skip if table missing.
      try {
        const { storage } = await import("../lib/storage.js");
        if (typeof (storage as any).patchOrgSettings === "function" && input.externalOrgId) {
          await (storage as any).patchOrgSettings(org.id, {
            "integrations.onboarding.externalOrgId": input.externalOrgId,
            "integrations.onboarding.path": input.path,
            "integrations.onboarding.idempotencyKey": input.idempotencyKey,
          });
        }
      } catch {
        /* settings optional */
      }

      const handoffClaims = buildHandoffClaims({
        jti: randomUUID(),
        userId: user.id,
        organizationId: org.id,
        workspaceId: sdr.workspaceId,
        email: user.email,
        path: input.path,
        prefill: input.prefill,
      });
      const code = mintHandoffCode(handoffClaims);
      const handoffUrl = buildHandoffLandingUrl(appOrigin(req), code);

      if (input.path === "staff_assisted") {
        void import("../lib/product-email.js")
          .then(({ sendProductEmail }) =>
            import("../lib/email-templates.js").then(({ inviteEmail }) =>
              sendProductEmail(
                user.email,
                inviteEmail({
                  firstName: user.firstName,
                  inviterName: "Catalyst onboarding",
                  organizationName: org.name,
                  email: user.email,
                  temporaryPassword: input.password ? null : tempPassword,
                  // Extra note via bodyHtml is fixed in template; handoff URL in ops runbook
                })
              )
            )
          )
          .catch((err: Error) => console.error("Staff-assisted invite email failed:", err.message));
      }

      return res.status(201).json({
        created: true,
        idempotent: false,
        organizationId: org.id,
        workspaceId: sdr.workspaceId,
        userId: user.id,
        email: user.email,
        onboardingComplete: false,
        path: input.path,
        handoffCode: code,
        handoffUrl,
        handoffExpiresInSeconds: DEFAULT_HANDOFF_TTL_SECONDS,
        temporaryPassword: input.password ? undefined : tempPassword,
      });
    } catch (error: any) {
      console.error("onboarding provision:", error);
      res.status(500).json({ error: error.message || "Provision failed" });
    }
  }
);

/**
 * POST /api/integrations/onboarding/handoff
 * Mint a fresh short-lived handoff code for an existing user (by email or userId).
 */
router.post(
  "/api/integrations/onboarding/handoff",
  requireOnboardingApiKey,
  async (req: Request, res: Response) => {
    try {
      const email =
        typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const userId = Number(req.body?.userId);
      let user;
      if (Number.isFinite(userId) && userId > 0) {
        [user] = await db.select().from(users).where(eq(users.id, userId));
      } else if (email) {
        [user] = await db.select().from(users).where(eq(users.email, email));
      } else {
        return res.status(400).json({ error: "email or userId required" });
      }
      if (!user?.organizationId) return res.status(404).json({ error: "User not found" });

      const sdr = await ensureOrgSdr(user.organizationId);
      const path: OnboardingPath =
        req.body?.path === "staff_assisted" ? "staff_assisted" : "self_serve";
      const { normalizePrefill } = await import("../lib/onboarding-handoff.js");
      const prefill = normalizePrefill(req.body?.prefill);

      const claims = buildHandoffClaims({
        jti: randomUUID(),
        userId: user.id,
        organizationId: user.organizationId,
        workspaceId: sdr.workspaceId,
        email: user.email,
        path,
        prefill,
      });
      const code = mintHandoffCode(claims);
      res.json({
        handoffCode: code,
        handoffUrl: buildHandoffLandingUrl(appOrigin(req), code),
        handoffExpiresInSeconds: DEFAULT_HANDOFF_TTL_SECONDS,
        organizationId: user.organizationId,
        workspaceId: sdr.workspaceId,
        userId: user.id,
        onboardingComplete: user.onboardingComplete ?? true,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * POST /api/integrations/onboarding/exchange
 * Public — exchange one-time handoff code for a Catalyst session JWT + prefill.
 */
router.post("/api/integrations/onboarding/exchange", async (req: Request, res: Response) => {
  try {
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!code) return res.status(400).json({ error: "code is required" });

    let decoded: unknown;
    try {
      decoded = jwt.verify(code, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: "Handoff expired or invalid" });
    }

    const parsed = parseHandoffClaims(decoded);
    if (!parsed.ok) return res.status(401).json({ error: parsed.error });
    const claims = parsed.value;

    if (!jtiStore.consume(claims.jti)) {
      return res.status(409).json({ error: "Handoff code already used" });
    }

    const [user] = await db.select().from(users).where(eq(users.id, claims.userId));
    if (!user || user.organizationId !== claims.organizationId) {
      return res.status(404).json({ error: "User not found for handoff" });
    }

    const sdr = await ensureOrgSdr(user.organizationId!);
    const token = sessionTokenFor(user, sdr);

    void emitOnboardingAppWebhook({
      type: "handoff.exchanged",
      organizationId: user.organizationId!,
      workspaceId: sdr.workspaceId,
      userId: user.id,
      email: user.email,
      meta: { path: claims.path },
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organizationId: user.organizationId,
        workspaceId: sdr.workspaceId,
        tier: sdr.tier,
        onboardingComplete: user.onboardingComplete ?? true,
      },
      path: claims.path,
      prefill: claims.prefill,
      purpose: HANDOFF_PURPOSE,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/integrations/onboarding/events
 * Inbound events from the onboarding app (e.g. onboarding.completed on their side).
 */
router.post(
  "/api/integrations/onboarding/events",
  requireOnboardingApiKey,
  async (req: Request, res: Response) => {
    try {
      const type = typeof req.body?.type === "string" ? req.body.type : "";
      const organizationId = Number(req.body?.organizationId);
      if (!type) return res.status(400).json({ error: "type is required" });
      if (!Number.isFinite(organizationId)) {
        return res.status(400).json({ error: "organizationId is required" });
      }

      console.log(`📥 Onboarding app event: ${type} org=${organizationId}`, {
        externalOrgId: req.body?.externalOrgId,
        userId: req.body?.userId,
      });

      // Acknowledge; Catalyst Levvi remains source of truth for sdr.activated.
      res.json({ received: true, type, organizationId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

export default router;
