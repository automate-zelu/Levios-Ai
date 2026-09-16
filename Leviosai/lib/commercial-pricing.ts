/**
 * Commercial pricing: global monthly retainer + per-org appointment fees.
 *
 * - Monthly fee: platform-wide; always on — cannot be disabled.
 * - Appointment fee: per-org rate; charged when the voice/calendar agent books a job.
 *   Still billed to the saved card if the client cancels the monthly subscription.
 * Appointment fee can be enabled/disabled per client. Toggles never rewrite existing charges.
 */

export const DEFAULT_GLOBAL_MONTHLY_FEE_CENTS = 29_700; // $297
export const DEFAULT_APPOINTMENT_FEE_CENTS = 0;

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
