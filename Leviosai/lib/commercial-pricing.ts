/**
 * Commercial pricing: global monthly retainer + per-org appointment fees.
 *
 * ## Where does $297 come from? (P1.1)
 * `DEFAULT_GLOBAL_MONTHLY_FEE_CENTS` (29_700) is the **single source of truth** for the
 * platform-wide monthly retainer default. It is the Starter / **Ignite** list price —
 * the low end of the Starter suggested band ($297–$497). Org overrides live on
 * `organizations.monthly_fee_override_cents` and are resolved via `resolveCommercialPricing`.
 *
 * SaaS catalog keys in `lib/pricing.ts` / `lib/tiers.ts` must import this constant for
 * Starter rather than hardcoding 29700 again.
 *
 * Marketing names (Anthony / Catalyst): Ignite · Catalyze · Chain Reaction
 * (see `MARKETING_PLAN_BY_KEY`). Confirm with Anthony that Starter/Ignite = $297 remains intentional.
 *
 * - Monthly fee: platform-wide; always on — cannot be disabled.
 * - Appointment fee: per-org rate; charged when the voice/calendar agent books a job.
 *   Still billed to the saved card if the client cancels the monthly subscription.
 * Appointment fee can be enabled/disabled per client. Toggles never rewrite existing charges.
 */

/** Platform default monthly retainer — Starter / Ignite list price ($297). */
export const DEFAULT_GLOBAL_MONTHLY_FEE_CENTS = 29_700;
export const DEFAULT_APPOINTMENT_FEE_CENTS = 0;

/** Allowed monthly retainer range for admin edits (USD cents). */
export const MONTHLY_FEE_MIN_CENTS = 0;
export const MONTHLY_FEE_MAX_CENTS = 50_000_00; // $50,000

/** Allowed per-appointment fee range (USD cents). */
export const APPOINTMENT_FEE_MIN_CENTS = 0;
export const APPOINTMENT_FEE_MAX_CENTS = 10_000_00; // $10,000

/**
 * Code plan keys → Catalyst marketing names.
 * Starter = Ignite ($297 default), Growth = Catalyze, Scale+ = Chain Reaction.
 */
export const MARKETING_PLAN_BY_KEY = {
  starter: "Ignite",
  growth: "Catalyze",
  scale: "Chain Reaction",
  enterprise: "Chain Reaction",
} as const;

export type MarketingPlanKey = keyof typeof MARKETING_PLAN_BY_KEY;

export function marketingNameForPlan(key: string): string | null {
  return (MARKETING_PLAN_BY_KEY as Record<string, string>)[key] ?? null;
}

/**
 * Legal footnote for “per appointment*” copy (P1.5).
 * Weekly/monthly collection cadence is at Leviosa Labs discretion.
 */
export const PER_APPOINTMENT_ASTERISK = "*";
export const PER_APPOINTMENT_FOOTNOTE =
  "* Per-appointment fees may be billed per booking, or collected on a weekly or monthly cadence at Leviosa Labs’ discretion.";

export type CommercialFeeKind = "monthly" | "appointment";

export interface PlatformCommercialDefaults {
  monthlyFeeCents: number;
  monthlyFeeEnabledByDefault: boolean;
  defaultAppointmentFeeCents: number;
}

export interface OrgCommercialOverrides {
  monthlyFeeEnabled: boolean | null;
  monthlyFeeOverrideCents: number | null;
  appointmentFeeEnabled: boolean | null;
  costPerAppointmentCents: number | null;
}

export interface ResolvedCommercialPricing {
  monthlyFeeEnabled: boolean;
  monthlyFeeCents: number;
  monthlyUsesGlobalAmount: boolean;
  appointmentFeeEnabled: boolean;
  appointmentFeeCents: number;
}

export function normalizeCents(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n);
}

/** Clamp + validate fee cents for admin PATCH (throws on out-of-range). */
export function validateFeeCents(
  value: unknown,
  opts: { min: number; max: number; label: string }
): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < opts.min || n > opts.max) {
    throw new Error(
      `${opts.label} must be between ${formatUsdFromCents(opts.min)} and ${formatUsdFromCents(opts.max)}`
    );
  }
  return Math.round(n);
}

export function resolveCommercialPricing(
  platform: PlatformCommercialDefaults,
  org: OrgCommercialOverrides
): ResolvedCommercialPricing {
  const monthlyFeeEnabled = true;

  const hasOverride =
    org.monthlyFeeOverrideCents != null && Number.isFinite(Number(org.monthlyFeeOverrideCents));
  const monthlyFeeCents = hasOverride
    ? normalizeCents(org.monthlyFeeOverrideCents, platform.monthlyFeeCents)
    : normalizeCents(platform.monthlyFeeCents, DEFAULT_GLOBAL_MONTHLY_FEE_CENTS);

  const appointmentFeeEnabled =
    org.appointmentFeeEnabled == null ? false : !!org.appointmentFeeEnabled;

  const appointmentFeeCents = normalizeCents(org.costPerAppointmentCents, 0);

  return {
    monthlyFeeEnabled,
    monthlyFeeCents,
    monthlyUsesGlobalAmount: !hasOverride,
    appointmentFeeEnabled,
    appointmentFeeCents,
  };
}

/** Amount to bill for one booked appointment, or null when fee is off / zero. */
export function planAppointmentCharge(
  pricing: ResolvedCommercialPricing
): { amountCents: number; feeKind: "appointment" } | null {
  if (!pricing.appointmentFeeEnabled) return null;
  if (pricing.appointmentFeeCents <= 0) return null;
  return { amountCents: pricing.appointmentFeeCents, feeKind: "appointment" };
}

/** Amount to bill for the monthly retainer, or null when fee is off / zero. */
export function planMonthlyCharge(
  pricing: ResolvedCommercialPricing
): { amountCents: number; feeKind: "monthly" } | null {
  if (!pricing.monthlyFeeEnabled) return null;
  if (pricing.monthlyFeeCents <= 0) return null;
  return { amountCents: pricing.monthlyFeeCents, feeKind: "monthly" };
}

/**
 * Hybrid invoice preview: retainer + appointment usage (+ optional extra meters).
 * Zero-usage months still include the retainer line when monthly is on.
 */
export function buildHybridInvoicePreview(input: {
  pricing: ResolvedCommercialPricing;
  appointmentCount?: number;
  extraUsageLines?: Array<{ label: string; quantity: number; unitCents: number; includedInRetainer?: boolean }>;
}): {
  lines: Array<{
    kind: string;
    label: string;
    quantity: number;
    amountCents: number;
    includedInRetainer: boolean;
  }>;
  retainerCents: number;
  usageCents: number;
  totalCents: number;
} {
  const lines: Array<{
    kind: string;
    label: string;
    quantity: number;
    amountCents: number;
    includedInRetainer: boolean;
  }> = [];

  const monthly = planMonthlyCharge(input.pricing);
  const retainerCents = monthly?.amountCents ?? 0;
  if (monthly) {
    lines.push({
      kind: "monthly",
      label: "Monthly retainer",
      quantity: 1,
      amountCents: monthly.amountCents,
      includedInRetainer: false,
    });
  }

  const apptCount = Math.max(0, Math.floor(Number(input.appointmentCount) || 0));
  const apptPlan = planAppointmentCharge(input.pricing);
  let usageCents = 0;
  if (apptPlan && apptCount > 0) {
    const amount = apptPlan.amountCents * apptCount;
    usageCents += amount;
    lines.push({
      kind: "appointment",
      label: "Per appointment*",
      quantity: apptCount,
      amountCents: amount,
      includedInRetainer: false,
    });
  }

  for (const extra of input.extraUsageLines || []) {
    const qty = Math.max(0, Number(extra.quantity) || 0);
    const unit = Math.max(0, Number(extra.unitCents) || 0);
    const amount = extra.includedInRetainer ? 0 : unit * qty;
    if (!extra.includedInRetainer) usageCents += amount;
    lines.push({
      kind: "usage",
      label: extra.label,
      quantity: qty,
      amountCents: amount,
      includedInRetainer: !!extra.includedInRetainer,
    });
  }

  return {
    lines,
    retainerCents,
    usageCents,
    totalCents: retainerCents + usageCents,
  };
}

export function formatUsdFromCents(cents: number): string {
  const dollars = cents / 100;
  return dollars % 1 === 0
    ? `$${dollars.toLocaleString("en-US")}`
    : `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function parseUsdToCents(input: string | number): number | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) return null;
    return Math.round(input * 100);
  }
  const cleaned = String(input || "").replace(/[$,\s]/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function dollarsInputFromCents(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "";
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
}
