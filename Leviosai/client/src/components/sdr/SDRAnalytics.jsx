import { COLORS, S } from "../../theme.js";
import { UsageBar } from "../billing/UsageBar.jsx";
import { UpgradePrompt } from "../billing/UpgradePrompt.jsx";

export function SDRAnalytics({ analytics, onUpgrade }) {
  if (!analytics) return null;

  const cards = [
    { label: "Total Enrollments", value: analytics.totalEnrollments, color: COLORS.blue },
    { label: "Bookings", value: analytics.booked, color: COLORS.green },
    { label: "Booking Rate", value: `${analytics.bookedRate}%`, color: COLORS.teal },
    { label: "Active Sequences", value: analytics.active, color: COLORS.orange },
  ];

  return (
    <>
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

      {analytics.usage && (
        <>
          <UsageBar usage={analytics.usage} />
          <UpgradePrompt usage={analytics.usage} onUpgrade={onUpgrade} />
        </>
      )}
    </>
  );
}
