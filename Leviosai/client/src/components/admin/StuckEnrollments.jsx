import { useState } from "react";
import { COLORS, S } from "../../theme.js";
import { adminApi } from "../../api.js";

const STATUS_COLORS = {
  pending: COLORS.textMuted,
  call_initiated: COLORS.blue,
  call_connected: COLORS.teal,
  call_no_answer: COLORS.yellow,
  sms_sent: COLORS.orange,
  email_sent: COLORS.purple,
  booked: COLORS.green,
  exhausted: COLORS.red,
  paused: COLORS.textMuted,
};

/**
 * Stuck enrollments table + one-click recover (plan §13.5).
 */
export function StuckEnrollments({ stuck, onRefresh }) {
  const [recoveringId, setRecoveringId] = useState(null);

  const handleRecover = async (enrollmentId) => {
    setRecoveringId(enrollmentId);
    try {
      const data = await adminApi.recoverEnrollment(enrollmentId);
      alert(`Recovered: ${data.fromStatus} → ${data.action}`);
      onRefresh?.();
    } catch (e) {
      alert(e.message || "Recovery failed");
    } finally {
      setRecoveringId(null);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Stuck Enrollments</h2>
        <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "3px 0 0" }}>
          Sequences past their expected threshold — recover re-queues the correct job.
        </p>
      </div>

      {(stuck || []).length === 0 ? (
        <div style={{ ...S.card, textAlign: "center", color: COLORS.textMuted, padding: 40 }}>
          No stuck enrollments. All SDR sequences look healthy.
        </div>
      ) : (
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
          <table style={S.table}>
            <thead>
              <tr style={{ background: COLORS.surfaceAlt }}>
                <th style={S.th}>Enrollment</th>
                <th style={S.th}>Status</th>
                <th style={S.th}>Workspace</th>
                <th style={S.th}>Stuck Since</th>
                <th style={S.th}>Recover</th>
              </tr>
            </thead>
            <tbody>
              {stuck.map((e) => {
                const id = e.enrollmentId || e.id;
                return (
                <tr key={id} style={{ borderBottom: `1px solid ${COLORS.border}22` }}>
                  <td style={S.td}>
                    <div style={{ fontFamily: "monospace", fontSize: 12 }}>{String(id).slice(0, 16)}…</div>
                  </td>
                  <td style={S.td}>
                    <span style={S.badge(STATUS_COLORS[e.status] || COLORS.textMuted)}>{e.status}</span>
                  </td>
                  <td style={S.td}>
                    <div style={{ fontSize: 12 }}>{e.workspaceName || e.workspaceId || "—"}</div>
                  </td>
                  <td style={S.td}>
                    <div style={{ fontSize: 12, color: COLORS.red }}>
                      {e.stuckSince || e.updatedAt
                        ? new Date(e.stuckSince || e.updatedAt).toLocaleString()
                        : "—"}
                      {e.ageHours != null ? ` (${e.ageHours}h)` : ""}
                    </div>
                  </td>
                  <td style={S.td}>
                    <button
                      style={{
                        ...S.btn("primary"),
                        padding: "4px 12px",
                        fontSize: 11,
                        opacity: recoveringId === id ? 0.6 : 1,
                      }}
                      onClick={() => handleRecover(id)}
                      disabled={recoveringId === id}
                    >
                      {recoveringId === id ? "Recovering…" : "Recover"}
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
