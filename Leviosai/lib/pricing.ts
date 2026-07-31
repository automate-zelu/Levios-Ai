// ─── Client-facing SaaS pricing (IMPLEMENTATION_PLAN §15.1 / §21.3) ───────────
// Flat monthly subscriptions. Dollar amounts are the default Stripe list prices
// (low end of each suggested band). Ranges are shown in UI as guidance.

import type { SdrTier } from "./tiers.js";
import { TIER_LIMITS, UNLIMITED } from "./tiers.js";

export type PaidPlanKey = "starter" | "growth" | "scale" | "enterprise";

export interface PlanPricing {
  key: PaidPlanKey;
  name: string;
  /** Default Stripe recurring price in cents (USD) — low end of suggested band */
  monthlyPriceCents: number;
  /** Suggested band low (USD) from plan §21.3 */
  suggestedMinUsd: number;
  /** Suggested band high (USD) from plan §21.3 */
  suggestedMaxUsd: number;
  priceHint: string;
  leadsPerMonth: number;
  minutesPerMonth: number;
  seats: number;
  features: string[];
}

/** Paid catalog — order used on Billing / Onboarding. */
export const PAID_PLAN_ORDER: PaidPlanKey[] = ["starter", "growth", "scale", "enterprise"];

/**
 * Default list prices = lower bound of plan §21.3 suggested bands.
 * Create matching Prices in Stripe (or run `npm run stripe:sync-prices`).
 */
export const PLAN_PRICING: Record<PaidPlanKey, PlanPricing> = {
  starter: {
    key: "starter",
    name: "Starter",
    monthlyPriceCents: 29_700, // $297
    suggestedMinUsd: 297,
    suggestedMaxUsd: 497,
    priceHint: TIER_LIMITS.starter.priceHint,
    leadsPerMonth: TIER_LIMITS.starter.monthlyLeadLimit,
    minutesPerMonth: TIER_LIMITS.starter.monthlyMinuteLimit,
    seats: TIER_LIMITS.starter.seatLimit,
    features: ["500 leads / mo", "1,000 calling minutes", "2 seats", "Full AI SDR sequence"],
  },
  growth: {
    key: "growth",
    name: "Growth",
    monthlyPriceCents: 79_700, // $797
    suggestedMinUsd: 797,
    suggestedMaxUsd: 997,
    priceHint: TIER_LIMITS.growth.priceHint,
    leadsPerMonth: TIER_LIMITS.growth.monthlyLeadLimit,
    minutesPerMonth: TIER_LIMITS.growth.monthlyMinuteLimit,
    seats: TIER_LIMITS.growth.seatLimit,
    features: ["2,000 leads / mo", "4,000 calling minutes", "5 seats", "Priority support"],
  },
  scale: {
    key: "scale",
    name: "Scale",
    monthlyPriceCents: 149_700, // $1,497
    suggestedMinUsd: 1_497,
    suggestedMaxUsd: 1_997,
    priceHint: TIER_LIMITS.scale.priceHint,
    leadsPerMonth: TIER_LIMITS.scale.monthlyLeadLimit,
    minutesPerMonth: TIER_LIMITS.scale.monthlyMinuteLimit,
    seats: TIER_LIMITS.scale.seatLimit,
    features: ["5,000 leads / mo", "10,000 calling minutes", "15 seats", "Volume pricing"],
  },
  enterprise: {
    key: "enterprise",
    name: "Enterprise",
    monthlyPriceCents: 249_700, // $2,497
    suggestedMinUsd: 2_497,
    suggestedMaxUsd: 3_497,
    priceHint: TIER_LIMITS.enterprise.priceHint,
    leadsPerMonth: TIER_LIMITS.enterprise.monthlyLeadLimit,
    minutesPerMonth: TIER_LIMITS.enterprise.monthlyMinuteLimit,
    seats: TIER_LIMITS.enterprise.seatLimit,
    features: ["10,000+ leads / mo", "Unlimited minutes", "Unlimited seats", "Dedicated support"],
  },
};

export function formatUsdFromCents(cents: number): string {
  const dollars = cents / 100;
  return dollars % 1 === 0
    ? `$${dollars.toLocaleString("en-US")}`
    : `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatMonthlyPriceLabel(cents: number): string {
  return `${formatUsdFromCents(cents)} / mo`;
}

export function formatLimit(n: number): string {
  if (n >= UNLIMITED || n < 0) return "Unlimited";
  return n.toLocaleString("en-US");
}

export function isPaidPlanKey(value: string): value is PaidPlanKey {
  return value in PLAN_PRICING;
}

export function getPlanPricing(key: string): PlanPricing | null {
  return isPaidPlanKey(key) ? PLAN_PRICING[key] : null;
}

/** Env var name that holds the Stripe Price ID for a paid plan. */
export function stripePriceEnvKey(plan: PaidPlanKey): string {
  return `STRIPE_${plan.toUpperCase()}_PRICE_ID`;
}

export function resolveStripePriceId(plan: PaidPlanKey): string | null {
  const primary = process.env[stripePriceEnvKey(plan)]?.trim();
  if (primary) return primary;
  // Legacy alias: STRIPE_PRO_PRICE_ID → growth
  if (plan === "growth") {
    const pro = process.env.STRIPE_PRO_PRICE_ID?.trim();
    if (pro) return pro;
  }
  return null;
}

/** Public catalog for /api/billing/plans (no secret price IDs). */
export function listPublicPlans(): Array<{
  key: string;
  name: string;
  sdrTier: SdrTier;
  monthlyPriceCents: number | null;
  monthlyPriceLabel: string | null;
  priceHint: string;
  suggestedMinUsd: number | null;
  suggestedMaxUsd: number | null;
  leadsLimit: number;
  minutesLimit: number;
  seatLimit: number;
  features: string[];
  priceId: "configured" | null;
  purchasable: boolean;
}> {
  const free = {
    key: "free",
    name: "Free",
    sdrTier: "starter" as SdrTier,
    monthlyPriceCents: null,
    monthlyPriceLabel: null,
    priceHint: "Subscribe to activate SDR",
    suggestedMinUsd: null,
    suggestedMaxUsd: null,
    leadsLimit: 0,
    minutesLimit: 0,
    seatLimit: 1,
    features: ["No AI calling until subscribed"],
    priceId: null as "configured" | null,
    purchasable: false,
  };

  const paid = PAID_PLAN_ORDER.map((key) => {
    const p = PLAN_PRICING[key];
    const priceId = resolveStripePriceId(key);
    return {
      key,
      name: p.name,
      sdrTier: key as SdrTier,
      monthlyPriceCents: p.monthlyPriceCents,
      monthlyPriceLabel: formatMonthlyPriceLabel(p.monthlyPriceCents),
      priceHint: p.priceHint,
      suggestedMinUsd: p.suggestedMinUsd,
      suggestedMaxUsd: p.suggestedMaxUsd,
      leadsLimit: p.leadsPerMonth,
      minutesLimit: p.minutesPerMonth,
      seatLimit: p.seats,
      features: p.features,
      priceId: priceId ? ("configured" as const) : null,
      purchasable: !!priceId,
    };
  });

  return [free, ...paid];
}
