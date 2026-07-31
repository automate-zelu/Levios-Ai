// ─── ADMIN HELPERS ───────────────────────────────────────────────────────────
// Pure helpers for Leviosai operator admin panel (plan §11.4 / §13.5).

import { isUnlimited } from "./tiers.js";

/** Plan §11.4 — flag workspaces at 90%+ of a tier limit for upsell. */
export const ADMIN_USAGE_ALERT_RATIO = 0.9;

export type WorkspaceUsageLike = {
  id: string;
  name?: string | null;
  tier?: string | null;
  isActive?: boolean | null;
  monthlyLeadsUsed?: number | null;
  monthlyLeadLimit?: number | null;
  monthlyMinutesUsed?: number | null;
  monthlyMinuteLimit?: number | null;
};

export function leadUsageRatio(ws: WorkspaceUsageLike): number {
  const used = Number(ws.monthlyLeadsUsed ?? 0);
  const limit = Number(ws.monthlyLeadLimit ?? 0);
  if (!limit || isUnlimited(limit)) return 0;
  return used / limit;
}

export function minuteUsageRatio(ws: WorkspaceUsageLike): number {
  const used = Number(ws.monthlyMinutesUsed ?? 0);
  const limit = Number(ws.monthlyMinuteLimit ?? 0);
  if (!limit || isUnlimited(limit)) return 0;
  return used / limit;
}

export function isWorkspaceNearLimit(
  ws: WorkspaceUsageLike,
  threshold = ADMIN_USAGE_ALERT_RATIO
): boolean {
  return leadUsageRatio(ws) >= threshold || minuteUsageRatio(ws) >= threshold;
}

export type UsageAlertReason = "leads" | "minutes" | "both";

export function usageAlertReason(
  ws: WorkspaceUsageLike,
  threshold = ADMIN_USAGE_ALERT_RATIO
): UsageAlertReason | null {
  const leads = leadUsageRatio(ws) >= threshold;
  const minutes = minuteUsageRatio(ws) >= threshold;
  if (leads && minutes) return "both";
  if (leads) return "leads";
  if (minutes) return "minutes";
  return null;
}

export function filterUsageAlerts<T extends WorkspaceUsageLike>(
  workspaces: T[],
  threshold = ADMIN_USAGE_ALERT_RATIO
): Array<T & { alertReason: UsageAlertReason; leadRatio: number; minuteRatio: number }> {
  return workspaces
    .filter((ws) => isWorkspaceNearLimit(ws, threshold))
    .map((ws) => ({
      ...ws,
      alertReason: usageAlertReason(ws, threshold)!,
      leadRatio: leadUsageRatio(ws),
      minuteRatio: minuteUsageRatio(ws),
    }));
}

/** Tier select options for admin UI (includes Scale). */
export const ADMIN_TIER_OPTIONS = ["starter", "growth", "scale", "enterprise"] as const;
