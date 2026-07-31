import { COLORS, S } from "../../theme.js";
import { filterUsageAlerts, tierBadgeColor, ADMIN_TIER_OPTIONS } from "../../lib/admin-helpers.js";

/**
 * Platform analytics + usage alerts (plan §13.5 PlatformAnalytics).
 */
export function PlatformAnalytics({ analytics, workspaceList, stuck }) {
  const alerts = filterUsageAlerts(workspaceList || []);
  const tiers = ADMIN_TIER_OPTIONS;
  const tierCounts = tiers.map((t) => ({
    tier: t,
    count: (workspaceList || []).filter((w) => w.tier === t).length,
  }));

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: COLORS.text }}>Platform Overview</h2>
        <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "4px 0 0" }}>
          Live snapshot across all client workspaces
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 14, marginBottom: 28 }}>
        {[
          { label: "Workspaces", value: analytics?.totalWorkspaces ?? "—", color: COLORS.blue },
          { label: "Active", value: analytics?.activeWorkspaces ?? "—", color: COLORS.green },
          { label: "Enrollments", value: analytics?.totalEnrollments ?? "—", color: COLORS.orange },
          { label: "Booked rate", value: analytics ? `${analytics.bookedRate}%` : "—", color: COLORS.teal },
          { label: "Calls", value: analytics?.totalCalls ?? "—", color: COLORS.blue },
          { label: "Answer rate", value: analytics ? `${analytics.answerRate ?? 0}%` : "—", color: COLORS.purple },
          { label: "Stuck", value: stuck?.length ?? "—", color: stuck?.length > 0 ? COLORS.red : COLORS.green },
          { label: "Usage alerts", value: alerts.length, color: alerts.length ? COLORS.yellow : COLORS.green },
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Workspaces by Tier</div>
          {tierCounts.map(({ tier, count }) => (
            <div key={tier} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 12, textTransform: "capitalize", color: COLORS.text }}>{tier}</span>
                <span style={{ fontSize: 12, color: COLORS.textMuted }}>{count}</span>
              </div>
              <div style={{ background: COLORS.surfaceAlt, borderRadius: 4, height: 6 }}>
                <div
                  style={{
                    height: 6,
                    borderRadius: 4,
                    background: tierBadgeColor(tier, COLORS),
                    width: `${workspaceList?.length ? (count / workspaceList.length) * 100 : 0}%`,
                    transition: "width 0.4s",
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Enrollments by Tier</div>
          {(analytics?.enrollmentsByTier || []).length === 0 ? (
            <div style={{ color: COLORS.textMuted, fontSize: 13 }}>No enrollment data yet.</div>
          ) : (
            (analytics.enrollmentsByTier || []).map((r) => (
              <div
                key={r.tier}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "10px 0",
                  borderBottom: `1px solid ${COLORS.border}22`,
                }}
              >
                <span style={{ ...S.badge(tierBadgeColor(r.tier, COLORS)), textTransform: "capitalize" }}>{r.tier}</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{r.enrollments} sequences</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Usage Alerts</div>
        <p style={{ color: COLORS.textMuted, fontSize: 12, margin: "0 0 14px" }}>
          Workspaces at 90%+ of monthly lead or minute limits — flag for upsell.
        </p>
        {alerts.length === 0 ? (
          <div style={{ color: COLORS.green, fontSize: 13 }}>No workspaces near limit.</div>
        ) : (
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Workspace</th>
                <th style={S.th}>Tier</th>
                <th style={S.th}>Leads</th>
                <th style={S.th}>Minutes</th>
                <th style={S.th}>Alert</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id}>
                  <td style={S.td}>{a.name}</td>
                  <td style={S.td}>
                    <span style={S.badge(tierBadgeColor(a.tier, COLORS))}>{a.tier}</span>
                  </td>
                  <td style={S.td}>
                    {a.monthlyLeadsUsed}/{a.monthlyLeadLimit} ({Math.round(a.leadRatio * 100)}%)
                  </td>
                  <td style={S.td}>
                    {a.monthlyMinutesUsed}/{a.monthlyMinuteLimit} ({Math.round(a.minuteRatio * 100)}%)
                  </td>
                  <td style={S.td}>
                    <span style={S.badge(COLORS.yellow)}>{a.alertReason}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
