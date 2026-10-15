/**
 * P5 — External onboarding app ↔ Catalyst handoff helpers (pure).
 * The onboarding app is Anthony’s separate product; Catalyst owns org/workspace/session.
 */

export const HANDOFF_PURPOSE = "catalyst_onboarding_handoff";
export const DEFAULT_HANDOFF_TTL_SECONDS = 15 * 60; // 15 minutes

export type OnboardingPath = "self_serve" | "staff_assisted";

export type OnboardingPrefill = {
  companyName?: string;
  industry?: string;
  website?: string;
  timezone?: string;
  weekdayStart?: string;
  weekdayEnd?: string;
  /** Optional Levvi step index hint (0–7). */
  step?: number;
  leadsSkipped?: boolean;
  kbSkipped?: boolean;
  channelsSkipped?: boolean;
};

export type ProvisionInput = {
  email: string;
  firstName: string;
  lastName: string;
  organizationName?: string;
  industry?: string;
  path?: OnboardingPath;
  /** Caller’s stable id — used for idempotent re-provision. */
  externalOrgId?: string;
  /** Optional password; staff-assisted often omits (temp password generated). */
  password?: string;
  prefill?: OnboardingPrefill;
  /** Idempotency key — same key returns the same provision result. */
  idempotencyKey?: string;
};

export type ProvisionNormalized = {
  email: string;
  firstName: string;
  lastName: string;
  organizationName: string;
  industry: string | null;
  path: OnboardingPath;
  externalOrgId: string | null;
  password: string | null;
  prefill: OnboardingPrefill;
  idempotencyKey: string | null;
};

export function normalizeEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const t = email.trim().toLowerCase();
  if (!t || !t.includes("@") || t.length > 320) return null;
  return t;
}

export function normalizeProvisionInput(raw: unknown): { ok: true; value: ProvisionNormalized } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Body must be an object" };
  const body = raw as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  if (!email) return { ok: false, error: "Valid email is required" };

  const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
  const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
  if (!firstName || !lastName) return { ok: false, error: "firstName and lastName are required" };

  const organizationName =
    (typeof body.organizationName === "string" && body.organizationName.trim()) ||
    `${firstName}'s Organization`;

  const industry =
    typeof body.industry === "string" && body.industry.trim() ? body.industry.trim() : null;

  const path: OnboardingPath =
    body.path === "staff_assisted" ? "staff_assisted" : "self_serve";

  const externalOrgId =
    typeof body.externalOrgId === "string" && body.externalOrgId.trim()
      ? body.externalOrgId.trim().slice(0, 128)
      : null;

  const password =
    typeof body.password === "string" && body.password.length >= 8 ? body.password : null;

  const idempotencyKey =
    typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim().slice(0, 128)
      : null;

  const prefill = normalizePrefill(body.prefill);
  if (industry && !prefill.industry) prefill.industry = industry;
  if (organizationName && !prefill.companyName) prefill.companyName = organizationName;

  return {
    ok: true,
    value: {
      email,
      firstName,
      lastName,
      organizationName,
      industry,
      path,
      externalOrgId,
      password,
      prefill,
      idempotencyKey,
    },
  };
}

export function normalizePrefill(raw: unknown): OnboardingPrefill {
  if (!raw || typeof raw !== "object") return {};
  const p = raw as Record<string, unknown>;
  const out: OnboardingPrefill = {};
  if (typeof p.companyName === "string" && p.companyName.trim()) out.companyName = p.companyName.trim();
  if (typeof p.industry === "string" && p.industry.trim()) out.industry = p.industry.trim();
  if (typeof p.website === "string" && p.website.trim()) out.website = p.website.trim();
  if (typeof p.timezone === "string" && p.timezone.trim()) out.timezone = p.timezone.trim();
  if (typeof p.weekdayStart === "string" && p.weekdayStart.trim()) out.weekdayStart = p.weekdayStart.trim();
  if (typeof p.weekdayEnd === "string" && p.weekdayEnd.trim()) out.weekdayEnd = p.weekdayEnd.trim();
  if (typeof p.step === "number" && Number.isFinite(p.step)) {
    out.step = Math.max(0, Math.min(7, Math.round(p.step)));
  }
  if (p.leadsSkipped === true) out.leadsSkipped = true;
  if (p.kbSkipped === true) out.kbSkipped = true;
  if (p.channelsSkipped === true) out.channelsSkipped = true;
  return out;
}

/** Map prefill → Levvi localStorage draft keys. */
export function prefillToOnboardingDraft(prefill: OnboardingPrefill): Record<string, unknown> {
  const draft: Record<string, unknown> = {};
  if (prefill.companyName) draft.companyName = prefill.companyName;
  if (prefill.industry) draft.industry = prefill.industry;
  if (prefill.website) draft.website = prefill.website;
  if (prefill.timezone) draft.timezone = prefill.timezone;
  if (prefill.weekdayStart) draft.weekdayStart = prefill.weekdayStart;
  if (prefill.weekdayEnd) draft.weekdayEnd = prefill.weekdayEnd;
  if (prefill.leadsSkipped) draft.leadsSkipped = true;
  if (prefill.kbSkipped) draft.kbSkipped = true;
  if (prefill.channelsSkipped) draft.channelsSkipped = true;
  return draft;
}

export type HandoffClaims = {
  purpose: typeof HANDOFF_PURPOSE;
  jti: string;
  userId: number;
  organizationId: number;
  workspaceId: string;
  email: string;
  path: OnboardingPath;
  prefill: OnboardingPrefill;
};

export function buildHandoffClaims(input: {
  jti: string;
  userId: number;
  organizationId: number;
  workspaceId: string;
  email: string;
  path: OnboardingPath;
  prefill?: OnboardingPrefill;
}): HandoffClaims {
  return {
    purpose: HANDOFF_PURPOSE,
    jti: input.jti,
    userId: input.userId,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    email: input.email,
    path: input.path,
    prefill: input.prefill || {},
  };
}

export function parseHandoffClaims(decoded: unknown): { ok: true; value: HandoffClaims } | { ok: false; error: string } {
  if (!decoded || typeof decoded !== "object") return { ok: false, error: "Invalid handoff token" };
  const d = decoded as Record<string, unknown>;
  if (d.purpose !== HANDOFF_PURPOSE) return { ok: false, error: "Wrong token purpose" };
  if (typeof d.jti !== "string" || !d.jti) return { ok: false, error: "Missing jti" };
  if (typeof d.userId !== "number" || !Number.isFinite(d.userId)) return { ok: false, error: "Missing userId" };
  if (typeof d.organizationId !== "number" || !Number.isFinite(d.organizationId)) {
    return { ok: false, error: "Missing organizationId" };
  }
  if (typeof d.workspaceId !== "string" || !d.workspaceId) return { ok: false, error: "Missing workspaceId" };
  if (typeof d.email !== "string" || !d.email) return { ok: false, error: "Missing email" };
  const path: OnboardingPath = d.path === "staff_assisted" ? "staff_assisted" : "self_serve";
  return {
    ok: true,
    value: {
      purpose: HANDOFF_PURPOSE,
      jti: d.jti,
      userId: d.userId,
      organizationId: d.organizationId,
      workspaceId: d.workspaceId,
      email: d.email,
      path,
      prefill: normalizePrefill(d.prefill),
    },
  };
}

export type OutboundEventType =
  | "onboarding.completed"
  | "sdr.activated"
  | "sdr.deactivated"
  | "handoff.exchanged";

export function buildOutboundWebhookPayload(input: {
  type: OutboundEventType;
  organizationId: number;
  workspaceId?: string | null;
  userId?: number | null;
  email?: string | null;
  externalOrgId?: string | null;
  meta?: Record<string, unknown>;
}) {
  return {
    type: input.type,
    occurredAt: new Date().toISOString(),
    organizationId: input.organizationId,
    workspaceId: input.workspaceId ?? null,
    userId: input.userId ?? null,
    email: input.email ?? null,
    externalOrgId: input.externalOrgId ?? null,
    meta: input.meta || {},
  };
}

export function buildHandoffLandingUrl(appOrigin: string, code: string): string {
  const base = appOrigin.replace(/\/$/, "");
  return `${base}/?handoff=${encodeURIComponent(code)}`;
}

/** In-memory single-use jti tracker (process lifetime). */
export function createJtiStore(ttlMs = DEFAULT_HANDOFF_TTL_SECONDS * 1000) {
  const used = new Map<string, number>();
  const prune = () => {
    const now = Date.now();
    for (const [k, exp] of used) {
      if (exp <= now) used.delete(k);
    }
  };
  return {
    consume(jti: string): boolean {
      prune();
      if (used.has(jti)) return false;
      used.set(jti, Date.now() + ttlMs);
      return true;
    },
    has(jti: string): boolean {
      prune();
      return used.has(jti);
    },
    _size() {
      prune();
      return used.size;
    },
  };
}

export function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
