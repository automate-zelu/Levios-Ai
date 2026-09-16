// ─── SDR TIER DEFINITIONS ────────────────────────────────────────────────────
// Single source of truth for plan limits (IMPLEMENTATION_PLAN §15.1 / §5).
// Used by admin tier changes, Stripe activation, seat enforcement, and UI.

export type SdrTier = "starter" | "growth" | "scale" | "enterprise";

export interface TierLimits {
  monthlyLeadLimit: number;
  monthlyMinuteLimit: number;
  /** Complimentary in-browser test-call minutes per billing period */
  monthlyTestMinuteLimit: number;
  seatLimit: number;
  /** Display label */
  label: string;
  /** Suggested monthly price band (guidance only) */
  priceHint: string;
}

/** Sentinel for "unlimited" — UI shows ∞; comparisons treat as effectively unlimited. */
export const UNLIMITED = 999_999;

export const TIER_LIMITS: Record<SdrTier, TierLimits> = {
  starter: {
    label: "Starter",
    monthlyLeadLimit: 500,
    monthlyMinuteLimit: 1_000,
    monthlyTestMinuteLimit: 20,
    seatLimit: 2,
    priceHint: "$297–$497 / mo",
  },
  growth: {
    label: "Growth",
    monthlyLeadLimit: 2_000,
    monthlyMinuteLimit: 4_000,
    monthlyTestMinuteLimit: 40,
    seatLimit: 5,
    priceHint: "$797–$997 / mo",
  },
  scale: {
    label: "Scale",
    monthlyLeadLimit: 5_000,
    monthlyMinuteLimit: 10_000,
    monthlyTestMinuteLimit: 60,
    seatLimit: 15,
    priceHint: "$1,497–$1,997 / mo",
  },
  enterprise: {
    label: "Enterprise",
    monthlyLeadLimit: UNLIMITED,
    monthlyMinuteLimit: UNLIMITED,
    monthlyTestMinuteLimit: 60,
    seatLimit: UNLIMITED,
    priceHint: "$2,497–$3,497 / mo",
  },
};

export const SDR_TIERS = Object.keys(TIER_LIMITS) as SdrTier[];

export function isSdrTier(value: string): value is SdrTier {
  return value in TIER_LIMITS;
}

export function getTierLimits(tier: string): TierLimits {
  if (isSdrTier(tier)) return TIER_LIMITS[tier];
  return TIER_LIMITS.starter;
}

/** Stripe / org plan key → SDR workspace tier */
export function planKeyToSdrTier(plan: string): SdrTier {
  const map: Record<string, SdrTier> = {
    free: "starter",
    starter: "starter",
    pro: "growth",
    growth: "growth",
    scale: "scale",
    enterprise: "enterprise",
  };
  return map[plan] ?? "starter";
}

export function isUnlimited(limit: number): boolean {
  return limit >= UNLIMITED;
}

export function isLeadLimitReached(used: number, limit: number): boolean {
  if (isUnlimited(limit)) return false;
  return used >= limit;
}

export function isMinuteLimitReached(used: number, limit: number): boolean {
  if (isUnlimited(limit)) return false;
  return used >= limit;
}

export function isSeatLimitReached(currentSeats: number, seatLimit: number): boolean {
  if (isUnlimited(seatLimit)) return false;
  return currentSeats >= seatLimit;
}

/** Pure helper for invite decisions (unit-tested). */
export function canInviteSeat(currentSeats: number, seatLimit: number): {
  allowed: boolean;
  reason?: string;
} {
  if (isSeatLimitReached(currentSeats, seatLimit)) {
    return {
      allowed: false,
      reason: `Seat limit reached (${currentSeats}/${seatLimit}). Upgrade your plan to invite more users.`,
    };
  }
  return { allowed: true };
}
