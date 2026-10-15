import { useEffect, useMemo, useState } from "react";
import { COLORS, S } from "../../theme.js";
import { activityApi, appointmentsApi, callApi } from "../../api.js";
import {
  buildLeadTimeline,
  filterTimelineByChannel,
} from "../../lib/lead-timeline.js";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "call", label: "Calls" },
  { id: "sms", label: "SMS" },
  { id: "email", label: "Email" },
  { id: "appointment", label: "Appts" },
  { id: "system", label: "System" },
];

const CHANNEL_COLOR = {
  call: COLORS.purple,
  sms: COLORS.blue,
  email: COLORS.teal,
  appointment: COLORS.green,
  system: COLORS.textMuted,
};

function formatWhen(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return String(iso);
  }
}

/**
 * Unified lead history — messages, calls, appointments, activity (P2.3).
 */
export function LeadTimelinePanel({ leadId, messages = [] }) {
  const [filter, setFilter] = useState("all");
  const [appointments, setAppointments] = useState([]);
  const [activity, setActivity] = useState([]);
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = Number(leadId);
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      appointmentsApi.list().then((rows) =>
        (Array.isArray(rows) ? rows : []).filter((a) => Number(a.leadId) === id)
      ).catch(() => []),
      activityApi.list({ entityType: "lead", entityId: id, limit: 50 }).catch(() => []),
      callApi.getSessions({ limit: 50 }).then((res) => {
        const sessions = Array.isArray(res) ? res : res?.data || [];
        return sessions.filter((s) => Number(s.leadId) === id);
      }).catch(() => []),
    ])
      .then(([appts, acts, sessions]) => {
        setAppointments(appts);
        setActivity(Array.isArray(acts) ? acts : []);
        setCalls(sessions);
      })
      .finally(() => setLoading(false));
  }, [leadId]);

  const items = useMemo(
    () =>
      buildLeadTimeline({
        messages,
        appointments,
        activity,
        callSessions: calls,
      }),
    [messages, appointments, activity, calls]
  );

  const filtered = useMemo(() => filterTimelineByChannel(items, filter), [items, filter]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            style={{
              ...S.btn(filter === f.id ? "primary" : "ghost"),
              padding: "6px 12px",
              fontSize: 12,
              minHeight: 36,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: COLORS.textMuted, fontSize: 13, padding: 24 }}>Loading timeline…</div>
      ) : filtered.length === 0 ? (
        <div
          style={{
            padding: 32,
            textAlign: "center",
            color: COLORS.textMuted,
            border: `1px dashed ${COLORS.border}`,
            borderRadius: 12,
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 8 }}>📭</div>
          <div style={{ fontWeight: 600, color: COLORS.text, marginBottom: 4 }}>No activity yet</div>
          <div style={{ fontSize: 13 }}>
            Calls, SMS, email, and appointments for this lead will appear here.
          </div>
        </div>
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 0 }}>
          {filtered.map((item, idx) => (
            <li
              key={item.id}
              style={{
                display: "grid",
                gridTemplateColumns: "16px 1fr",
                gap: 12,
                padding: "12px 0",
                borderBottom: idx < filtered.length - 1 ? `1px solid ${COLORS.border}44` : "none",
              }}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  marginTop: 6,
                  background: CHANNEL_COLOR[item.channel] || COLORS.textMuted,
                }}
              />
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 13 }}>{item.title}</strong>
                  <span style={{ fontSize: 11, color: COLORS.textMuted }}>{formatWhen(item.at)}</span>
                </div>
                <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 4, lineHeight: 1.45 }}>
                  {item.body}
                </div>
                {(item.direction || item.meta) && (
                  <div style={{ fontSize: 11, color: COLORS.textDim, marginTop: 4 }}>
                    {[item.channel, item.direction, item.meta].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
