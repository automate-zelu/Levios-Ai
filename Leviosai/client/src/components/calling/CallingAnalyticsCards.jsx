import { COLORS, S, formatDuration } from "../../theme.js";

export function CallingAnalyticsCards({ analytics }) {
  if (!analytics) return null;

  const cards = [
    { label: "Total Calls", value: analytics.totalCalls, color: COLORS.blue },
    { label: "Answer Rate", value: `${analytics.answerRate}%`, color: COLORS.teal },
    { label: "Bookings", value: analytics.booked, color: COLORS.green },
    {
      label: "Avg Duration",
      value: formatDuration(analytics.avgDurationSeconds),
      color: COLORS.orange,
    },
  ];

  return (
    <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
      {cards.map((s) => (
        <div key={s.label} style={S.statCard(s.color)}>
          <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
            {s.label}
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color: s.color }}>{s.value ?? "—"}</div>
        </div>
      ))}
    </div>
  );
}
