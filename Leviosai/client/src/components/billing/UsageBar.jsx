import { COLORS, S, isNearLimit, usageRatio } from "../../theme.js";

export function UsageBar({ usage }) {
  if (!usage) return null;

  const rows = [
    { label: "Leads Enrolled", used: usage.leadsUsed ?? 0, limit: usage.leadsLimit ?? 0, color: COLORS.orange },
    { label: "Call Minutes", used: usage.minutesUsed ?? 0, limit: usage.minutesLimit ?? 0, color: COLORS.blue },
  ];

  return (
    <div style={{ ...S.card, marginBottom: 24 }}>
      <div style={S.cardHeader}>Monthly Usage</div>
      {rows.map((u) => {
        const ratio = usageRatio(u.used, u.limit);
        const warn = isNearLimit(u.used, u.limit);
        return (
          <div key={u.label} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: COLORS.textMuted }}>{u.label}</span>
              <span style={{ fontWeight: 600, color: warn ? COLORS.red : COLORS.text }}>
                {u.used} / {u.limit === 999999 || u.limit <= 0 ? "∞" : u.limit}
              </span>
            </div>
            <div style={{ background: COLORS.surfaceAlt, borderRadius: 4, height: 6 }} role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={u.label}>
              <div
                style={{
                  height: 6,
                  borderRadius: 4,
                  background: warn ? COLORS.red : u.color,
                  width: `${Math.min(100, ratio * 100)}%`,
                  transition: "width 0.4s",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
