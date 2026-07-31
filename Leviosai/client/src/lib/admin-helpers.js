// Client mirror of lib/admin-helpers.ts for usage-alert UI.

export const ADMIN_USAGE_ALERT_RATIO = 0.9;
export const ADMIN_TIER_OPTIONS = ["starter", "growth", "scale", "enterprise"];

const UNLIMITED = 999_999;

function isUnlimited(limit) {
  return Number(limit) >= UNLIMITED;
}

export function leadUsageRatio(ws) {
  const used = Number(ws.monthlyLeadsUsed ?? 0);
  const limit = Number(ws.monthlyLeadLimit ?? 0);
  if (!limit || isUnlimited(limit)) return 0;
  return used / limit;
}

export function minuteUsageRatio(ws) {
  const used = Number(ws.monthlyMinutesUsed ?? 0);
  const limit = Number(ws.monthlyMinuteLimit ?? 0);
  if (!limit || isUnlimited(limit)) return 0;
  return used / limit;
}

export function isWorkspaceNearLimit(ws, threshold = ADMIN_USAGE_ALERT_RATIO) {
  return leadUsageRatio(ws) >= threshold || minuteUsageRatio(ws) >= threshold;
}

export function usageAlertReason(ws, threshold = ADMIN_USAGE_ALERT_RATIO) {
  const leads = leadUsageRatio(ws) >= threshold;
  const minutes = minuteUsageRatio(ws) >= threshold;
  if (leads && minutes) return "both";
  if (leads) return "leads";
  if (minutes) return "minutes";
  return null;
}

export function filterUsageAlerts(workspaces, threshold = ADMIN_USAGE_ALERT_RATIO) {
  return workspaces
    .filter((ws) => isWorkspaceNearLimit(ws, threshold))
    .map((ws) => ({
      ...ws,
      alertReason: usageAlertReason(ws, threshold),
      leadRatio: leadUsageRatio(ws),
      minuteRatio: minuteUsageRatio(ws),
    }));
}

export function tierBadgeColor(tier, COLORS) {
  if (tier === "enterprise") return COLORS.purple;
  if (tier === "scale") return COLORS.teal;
  if (tier === "growth") return COLORS.blue;
  return COLORS.orange;
}
