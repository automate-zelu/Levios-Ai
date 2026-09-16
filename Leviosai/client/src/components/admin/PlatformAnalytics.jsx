import { COLORS, S } from "../../theme.js";

/**
 * Platform analytics snapshot — no subscription tier breakdowns.
 */
export function PlatformAnalytics({ analytics, workspaceList, stuck }) {
  const active = (workspaceList || []).filter((w) => w.isActive).length;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: COLORS.text }}>Platform Overview</h2>
        <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "4px 0 0" }}>
          Live snapshot across all client workspaces. Pricing is global monthly + per-client appointment rates.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 14, marginBottom: 28 }}>
        {[
          { label: "Workspaces", value: analytics?.totalWorkspaces ?? workspaceList?.length ?? "—", color: COLORS.blue },
          { label: "Active", value: analytics?.activeWorkspaces ?? active ?? "—", color: COLORS.green },
          { label: "Enrollments", value: analytics?.totalEnrollments ?? "—", color: COLORS.orange },
          { label: "Booked rate", value: analytics ? `${analytics.bookedRate}%` : "—", color: COLORS.teal },
          { label: "Calls", value: analytics?.totalCalls ?? "—", color: COLORS.blue },
          { label: "Answer rate", value: analytics ? `${analytics.answerRate ?? 0}%` : "—", color: COLORS.purple },
          { label: "Stuck", value: stuck?.length ?? "—", color: stuck?.length > 0 ? COLORS.red : COLORS.green },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 12,
              padding: "16px 18px",
              borderTop: `3px solid ${s.color}`,
            }}
          >
            <div style={{ fontSize: 10, color: COLORS.textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
              {s.label}
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ ...S.card, marginBottom: 0 }}>
        <div style={S.cardHeader}>Pricing model</div>
        <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted, lineHeight: 1.5 }}>
          Clients are not on Starter / Growth / Scale plans. Set the global monthly retainer above,
          then open a workspace to set that client&apos;s per-appointment rate and toggles.
        </p>
      </div>
    </div>
  );
}
