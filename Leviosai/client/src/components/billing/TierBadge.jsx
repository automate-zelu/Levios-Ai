import { COLORS, S } from "../../theme.js";

const TIER_COLORS = {
  starter: COLORS.blue,
  growth: COLORS.orange,
  scale: COLORS.purple,
  enterprise: COLORS.teal,
  free: COLORS.textMuted,
};

export function TierBadge({ tier, active }) {
  const key = (tier || "starter").toLowerCase();
  const color = TIER_COLORS[key] || COLORS.textMuted;
  const label = key.charAt(0).toUpperCase() + key.slice(1);

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={S.badge(color)}>{label}</span>
      {active != null && (
        <span style={S.badge(active ? COLORS.green : COLORS.textMuted)}>
          {active ? "Active" : "Inactive"}
        </span>
      )}
    </span>
  );
}
