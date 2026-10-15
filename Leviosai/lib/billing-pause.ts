/**
 * Non-payment service pause (P1.4).
 *
 * On payment failure, pause outbound AI unless the org is pause-exempt
 * (approved weekly/monthly plan). Successful payment clears the pause.
 * Workspace `isActive` may also be toggled for SDR eligibility.
 */

export type BillingCadence = "per_appointment" | "weekly" | "monthly";

export const BILLING_CADENCES: BillingCadence[] = [
  "per_appointment",
  "weekly",
  "monthly",
];

export function isBillingCadence(value: unknown): value is BillingCadence {
  return typeof value === "string" && (BILLING_CADENCES as string[]).includes(value);
}

export interface OrgPauseState {
  billingCadence: BillingCadence;
  paymentPlanApproved: boolean;
  pauseExempt: boolean;
  servicePaused: boolean;
  pausedAt: Date | string | null;
  pauseReason: string | null;
}

export function shouldAutoPauseOnPaymentFailure(org: {
  pauseExempt?: boolean | null;
  paymentPlanApproved?: boolean | null;
}): boolean {
  // Approved weekly/monthly plans skip auto-pause.
  if (org.pauseExempt) return false;
  if (org.paymentPlanApproved) return false;
  return true;
}

export function isOutboundBlockedByPause(org: {
  servicePaused?: boolean | null;
}): boolean {
  return org.servicePaused === true;
}

export const SERVICE_PAUSED_BANNER =
  "Service paused — update payment to resume outbound AI calling, SMS, and email.";

export function pausePatchOnFailure(reason = "payment_failed"): {
  servicePaused: boolean;
  pausedAt: Date;
  pauseReason: string;
} {
  return {
    servicePaused: true,
    pausedAt: new Date(),
    pauseReason: reason,
  };
}

export function clearPausePatch(): {
  servicePaused: boolean;
  pausedAt: null;
  pauseReason: null;
} {
  return {
    servicePaused: false,
    pausedAt: null,
    pauseReason: null,
  };
}
