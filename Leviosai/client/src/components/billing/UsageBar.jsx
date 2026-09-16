import { COLORS, S, formatDuration } from "../../theme.js";

/** Period activity — commercial pricing has no lead/minute caps. */
export function UsageBar({ usage }) {
  if (!usage) return null;

  const leads = Number(usage.leadsUsed ?? 0);
  const minutes = Number(usage.minutesUsed ?? 0);
  const rows = [
    { label: "Leads enrolled", value: String(leads) },
    { label: "Call minutes", value: formatDuration(Math.round(minutes * 60)) },
  ];

  return (
    <div style={{ ...S.card, marginBottom: 24 }}>
      <div style={S.cardHeader}>Usage this period</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 16 }}>
        {rows.map((row) => (
          <div key={row.label}>
            <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 6 }}>{row.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: COLORS.text }}>{row.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
