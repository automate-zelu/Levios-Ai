import { COLORS, S, formatDuration } from "../../theme.js";

const OUTCOME_COLORS = {
  booked: COLORS.green, qualified: COLORS.teal, answered: COLORS.blue,
  no_answer: COLORS.textMuted, voicemail: COLORS.yellow, busy: COLORS.orange, failed: COLORS.red,
};
const STATUS_COLORS = { initiated: COLORS.yellow, active: COLORS.green, completed: COLORS.textMuted };
const STATUS_LABELS = { initiated: "Dialing…", active: "Live", completed: "Completed" };

export function CallLogTable({ sessions, onSelect }) {
  if (!sessions?.length) {
    return (
      <div style={S.card}>
        <div style={S.cardHeader}>Call History</div>
        <div style={{ textAlign: "center", color: COLORS.textMuted, padding: 40 }}>
          No calls yet. Calls appear here once the SDR agent initiates outbound calls.
        </div>
      </div>
    );
  }

  return (
    <div style={S.card}>
      <div style={S.cardHeader}>Call History</div>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>Date</th>
            <th style={S.th}>Lead</th>
            <th style={S.th}>Phone</th>
            <th style={S.th}>Duration</th>
            <th style={S.th}>Status</th>
            <th style={S.th}>Outcome</th>
            <th style={S.th}>Action</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id}>
              <td style={S.td}>{s.startedAt ? new Date(s.startedAt).toLocaleString() : "—"}</td>
              <td style={S.td}><span style={{ fontWeight: 600 }}>{s.leadName || "—"}</span></td>
              <td style={S.td}><span style={{ fontSize: 12, color: COLORS.textMuted }}>{s.leadPhone || "—"}</span></td>
              <td style={S.td}>{formatDuration(s.durationSeconds)}</td>
              <td style={S.td}>
                <span style={S.badge(STATUS_COLORS[s.status] || COLORS.yellow)}>
                  {STATUS_LABELS[s.status] || s.status || "Dialing…"}
                </span>
              </td>
              <td style={S.td}>
                {s.outcome
                  ? <span style={S.badge(OUTCOME_COLORS[s.outcome] || COLORS.textMuted)}>
                      {String(s.outcome).replace(/_/g, " ")}
                    </span>
                  : <span style={{ color: COLORS.textMuted, fontSize: 12 }}>—</span>}
              </td>
              <td style={S.td}>
                <button
                  type="button"
                  style={{ ...S.btn("ghost"), padding: "4px 12px", fontSize: 12 }}
                  onClick={() => onSelect?.(s)}
                >
                  View
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
