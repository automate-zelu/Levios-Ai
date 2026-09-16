// ─── SDR ENROLLMENT ELIGIBILITY ───────────────────────────────────────────────
// Pure helpers for dormant-scan + manual enroll (Module 7).
// Validates re-enrollment gate after re_enroll_days, and lead filters.
// Commercial pricing has no monthly lead caps; leftover limit helpers are unused by enroll.

import type { EnrollmentStatus } from "./schema.js";
import { isLeadLimitReached } from "./tiers.js";

/** Lead CRM statuses that must never enter / re-enter SDR. */
export const SKIP_LEAD_STATUSES = ["won", "lost"] as const;

/** Enrollment statuses that block a new / concurrent sequence. */
export const ACTIVE_ENROLLMENT_STATUSES: EnrollmentStatus[] = [
  "pending",
  "call_initiated",
  "call_connected",
  "call_answered",
  "call_no_answer",
  "call_busy",
  "call_failed",
  "sms_sent",
  "sms_replied",
  "email_sent",
  "email_replied",
  "re_enrolled",
];

export type EligibilityDenyReason =
  | "workspace_inactive"
  | "lead_limit"
  | "closed_lead"
  | "opted_out"
  | "dnc"
  | "active_enrollment"
  | "booked"
  | "reenroll_gate"
  | "not_dormant";

export type EligibilityMode = "fresh" | "reenroll";

export type EligibilityDecision =
  | { ok: true; mode: EligibilityMode; enrollmentId?: string }
  | { ok: false; reason: EligibilityDenyReason };

export type LeadEligibilityInput = {
  status?: string | null;
  consentStatus?: string | null;
  /** false = on DNC list; true/null = ok to contact at enrollment time */
  dncClean?: boolean | null;
  lastContactedAt?: Date | string | null;
};

export type EnrollmentEligibilityInput = {
  id: string;
  status: string;
  nextEnrollAfter?: Date | string | null;
};

export type WorkspaceEligibilityInput = {
  isActive?: boolean | null;
  monthlyLeadsUsed?: number | null;
  monthlyLeadLimit?: number | null;
};

function asDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** True when nextEnrollAfter is unset or already in the past. */
export function isReenrollGateOpen(
  nextEnrollAfter: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  const gate = asDate(nextEnrollAfter ?? null);
  if (!gate) return true;
  return gate.getTime() <= now.getTime();
}

/** Compute nextEnrollAfter = now + reEnrollDays. */
export function computeNextEnrollAfter(
  reEnrollDays: number,
  now: Date = new Date()
): Date {
  const days = Math.max(0, Number(reEnrollDays) || 0);
  const at = new Date(now.getTime());
  at.setDate(at.getDate() + days);
  return at;
}

/** Lead is dormant if never contacted or last contact before cutoff. */
export function isLeadDormant(
  lastContactedAt: Date | string | null | undefined,
  dormantDays: number,
  now: Date = new Date()
): boolean {
  const last = asDate(lastContactedAt ?? null);
  if (!last) return true;
  const cutoff = new Date(now.getTime());
  cutoff.setDate(cutoff.getDate() - Math.max(0, Number(dormantDays) || 0));
  return last.getTime() < cutoff.getTime();
}

export function shouldSkipWorkspaceForLeadLimit(
  used: number,
  limit: number
): boolean {
  return isLeadLimitReached(used, limit);
}

/**
 * After enrolling `alreadyEnrolledThisScan` leads in this workspace during the
 * current scan, would one more enrollment exceed the monthly lead limit?
 */
export function wouldExceedLeadLimitAfter(
  monthlyLeadsUsed: number,
  monthlyLeadLimit: number,
  alreadyEnrolledThisScan: number
): boolean {
  return isLeadLimitReached(
    Number(monthlyLeadsUsed || 0) + Number(alreadyEnrolledThisScan || 0),
    Number(monthlyLeadLimit || 0)
  );
}

/**
 * Decide whether a lead may be enrolled (fresh) or re-enrolled (exhausted gate).
 * Uses the *latest* enrollment for the lead/workspace pair.
 */
export function evaluateEnrollmentEligibility(opts: {
  lead: LeadEligibilityInput;
  latestEnrollment?: EnrollmentEligibilityInput | null;
  workspace?: WorkspaceEligibilityInput | null;
  dormantDays?: number;
  /** When false, skip the dormant-days check (manual enroll override). */
  requireDormant?: boolean;
  now?: Date;
}): EligibilityDecision {
  const now = opts.now ?? new Date();
  const lead = opts.lead;
  const ws = opts.workspace;
  const latest = opts.latestEnrollment ?? null;

  if (ws && ws.isActive === false) {
    return { ok: false, reason: "workspace_inactive" };
  }

  const leadStatus = (lead.status || "").toLowerCase();
  if ((SKIP_LEAD_STATUSES as readonly string[]).includes(leadStatus)) {
    return { ok: false, reason: "closed_lead" };
  }

  if (lead.consentStatus === "opted_out") {
    return { ok: false, reason: "opted_out" };
  }

  // Explicit DNC flag blocks enrollment (null/undefined = not yet scrubbed → allow;
  // call orchestrator still re-checks before dialing).
  if (lead.dncClean === false) {
    return { ok: false, reason: "dnc" };
  }

  if (opts.requireDormant !== false) {
    const dormantDays = opts.dormantDays ?? 7;
    if (!isLeadDormant(lead.lastContactedAt, dormantDays, now)) {
      return { ok: false, reason: "not_dormant" };
    }
  }

  if (!latest) {
    return { ok: true, mode: "fresh" };
  }

  const status = latest.status as EnrollmentStatus;

  if (status === "booked") {
    return { ok: false, reason: "booked" };
  }

  if (ACTIVE_ENROLLMENT_STATUSES.includes(status)) {
    return { ok: false, reason: "active_enrollment" };
  }

  if (status === "exhausted") {
    if (!isReenrollGateOpen(latest.nextEnrollAfter, now)) {
      return { ok: false, reason: "reenroll_gate" };
    }
    return { ok: true, mode: "reenroll", enrollmentId: latest.id };
  }

  // Unknown / unexpected terminal — treat as fresh-safe only if not active
  return { ok: true, mode: "fresh" };
}
