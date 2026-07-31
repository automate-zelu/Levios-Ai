import { COLORS, S, isNearLimit, usageRatio, USAGE_WARN_RATIO } from "../../theme.js";

/**
 * Banner shown when any usage meter is at/above 90% of its monthly limit.
 */
export function UpgradePrompt({ usage, onUpgrade }) {
  if (!usage) return null;

  const leadsNear = isNearLimit(usage.leadsUsed, usage.leadsLimit);
  const minsNear = isNearLimit(usage.minutesUsed, usage.minutesLimit);
  if (!leadsNear && !minsNear) return null;

  const parts = [];
  if (leadsNear) {
    parts.push(`leads at ${Math.round(usageRatio(usage.leadsUsed, usage.leadsLimit) * 100)}%`);
  }
  if (minsNear) {
    parts.push(`minutes at ${Math.round(usageRatio(usage.minutesUsed, usage.minutesLimit) * 100)}%`);
  }

  return (
    <div
      role="status"
      style={{
        marginBottom: 24,
        padding: "14px 18px",
        borderRadius: 10,
        border: `1px solid ${COLORS.orange}66`,
        background: COLORS.orangeGlow,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div>
        <div style={{ fontWeight: 700, fontSize: 14, color: COLORS.orangeLight }}>
          Approaching plan limit ({Math.round(USAGE_WARN_RATIO * 100)}%+)
        </div>
        <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 4 }}>
          You&apos;re at {parts.join(" and ")}. Upgrade to avoid sequence pauses.
        </div>
      </div>
      {onUpgrade && (
        <button type="button" style={{ ...S.btn("primary"), padding: "8px 16px", fontSize: 12 }} onClick={onUpgrade}>
          Upgrade plan
        </button>
      )}
    </div>
  );
}
