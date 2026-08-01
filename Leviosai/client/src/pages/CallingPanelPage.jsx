import { useEffect, useMemo, useRef, useState } from "react";
import { COLORS, S, formatDuration } from "../theme.js";
import { callApi } from "../api.js";
import { RecordingPlayer } from "../components/calling/RecordingPlayer.jsx";
import { TranscriptViewer } from "../components/calling/TranscriptViewer.jsx";
import { SdrFlowTimeline } from "../components/sdr/SdrFlowTimeline.jsx";

const OUTCOME_META = {
  booked: { label: "Booking made", color: COLORS.green, tone: "success", short: "Booked" },
  qualified: { label: "Qualified", color: COLORS.teal, tone: "positive", short: "Qualified" },
  answered: { label: "Answered", color: COLORS.blue, tone: "positive", short: "Answered" },
  voicemail: { label: "Voicemail", color: COLORS.yellow, tone: "neutral", short: "Voicemail" },
  no_answer: { label: "No answer", color: COLORS.textMuted, tone: "missed", short: "Missed" },
  busy: { label: "Busy", color: COLORS.orange, tone: "missed", short: "Busy" },
  failed: { label: "Failed", color: COLORS.red, tone: "failed", short: "Failed" },
};

function outcomeMeta(outcome) {
  if (!outcome) return { label: "In progress", color: COLORS.yellow, tone: "pending", short: "Live" };
  return OUTCOME_META[outcome] || {
    label: String(outcome).replace(/_/g, " "),
    color: COLORS.textMuted,
    tone: "neutral",
    short: String(outcome).replace(/_/g, " "),
  };
}

function isSuccessful(outcome) {
  return outcome === "booked" || outcome === "qualified" || outcome === "answered";
}

const FILTERS = [
  { id: "all", label: "All calls" },
  { id: "booked", label: "Bookings" },
  { id: "answered", label: "Answered" },
  { id: "missed", label: "Missed" },
  { id: "failed", label: "Failed" },
];

export default function CallingPanelPage() {
  const [sessions, setSessions] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState("list"); // list | detail

  const selectedRef = useRef(null);
  selectedRef.current = selected;

  const fetchData = async (silent = false) => {
    try {
      const [s, a] = await Promise.all([
        callApi.getSessions({ limit: 80 }),
        callApi.getAnalytics(),
      ]);
      setSessions(s?.data || []);
      setAnalytics(a);
      const cur = selectedRef.current;
      if (cur) {
        const refreshed = (s?.data || []).find((x) => x.id === cur.id);
        if (refreshed) setSelected(refreshed);
      }
    } catch { /* ignore */ }
    if (!silent) setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    const hasActive = sessions.some((s) => s.status !== "completed");
    if (!hasActive) return;
    const t = setInterval(() => fetchData(true), 5000);
    return () => clearInterval(t);
  }, [sessions]);

  useEffect(() => {
    if (!selected?.id || view !== "detail") return;
    setDetailLoading(true);
    callApi
      .getSession(selected.id)
      .then((data) => {
        if (data?.session) setDetail(data);
        else setDetail({ session: data, logs: [], messages: [], callSessions: [data] });
      })
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }, [selected?.id, view]);

  const stats = useMemo(() => {
    const by = analytics?.byOutcome || {};
    const booked = Number(by.booked || analytics?.booked || 0);
    const answered = Number(analytics?.answered || 0);
    const noAnswer = Number(by.no_answer || 0);
    const failed = Number(by.failed || 0) + Number(by.busy || 0);
    const total = Number(analytics?.totalCalls || sessions.length || 0);
    const bookingRate = answered > 0 ? Math.round((booked / answered) * 100) : 0;
    return { booked, answered, noAnswer, failed, total, bookingRate, avgDuration: analytics?.avgDurationSeconds };
  }, [analytics, sessions]);

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (filter === "all") return true;
      if (filter === "booked") return s.outcome === "booked";
      if (filter === "answered") return ["answered", "qualified", "booked"].includes(s.outcome);
      if (filter === "missed") return ["no_answer", "busy", "voicemail"].includes(s.outcome);
      if (filter === "failed") return s.outcome === "failed" || (!s.outcome && s.status === "completed");
      return true;
    });
  }, [sessions, filter]);

  const openSession = (s) => {
    setSelected(s);
    setDetail(null);
    setView("detail");
  };

  if (loading) {
    return (
      <div className="loading-state">
        <div className="loading-spinner" />
        <div style={{ fontSize: 14, color: COLORS.textMuted }}>Loading call performance…</div>
      </div>
    );
  }

  if (view === "detail" && selected) {
    const sessionView = detail?.session || selected;
    const meta = outcomeMeta(sessionView?.outcome);
    return (
      <div>
        <button type="button" style={{ ...S.btn("ghost"), marginBottom: 16 }} onClick={() => setView("list")}>
          ← Back to call log
        </button>

        <div
          style={{
            ...S.card,
            borderTop: `3px solid ${meta.color}`,
            marginBottom: 16,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 11, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                Dial result
              </div>
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
                {sessionView?.leadName || selected.leadName || "Unknown lead"}
              </h2>
              <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 6 }}>
                {sessionView?.leadPhone || selected.leadPhone || "—"}
                {" · "}
                {sessionView?.startedAt ? new Date(sessionView.startedAt).toLocaleString() : "—"}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <span style={{ ...S.badge(meta.color), fontSize: 12, padding: "6px 12px" }}>{meta.label}</span>
              <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 8 }}>
                {isSuccessful(sessionView?.outcome) ? "Successful outreach" : sessionView?.outcome ? "Did not convert" : "In progress"}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12, marginTop: 20 }}>
            <MiniStat label="Duration" value={sessionView?.durationSeconds != null ? formatDuration(sessionView.durationSeconds) : "—"} />
            <MiniStat label="Status" value={sessionView?.status === "completed" ? "Completed" : sessionView?.status || "—"} />
            <MiniStat label="Outcome" value={meta.short} />
            <MiniStat
              label="Booking"
              value={sessionView?.outcome === "booked" ? "Yes" : "No"}
              accent={sessionView?.outcome === "booked" ? COLORS.green : undefined}
            />
          </div>
        </div>

        <div style={S.card}>
          <div style={S.cardHeader}>What happened on this dial</div>
          {detailLoading ? (
            <div style={{ color: COLORS.textMuted, fontSize: 13, textAlign: "center", padding: 28 }}>Loading…</div>
          ) : (
            <SdrFlowTimeline
              title="Dial flow"
              logs={detail?.logs || []}
              messages={detail?.messages || []}
              callSessions={detail?.callSessions || [sessionView]}
            />
          )}
        </div>

        <RecordingPlayer url={sessionView?.recordingUrl} />
        <TranscriptViewer transcript={sessionView?.transcript} summary={sessionView?.aiSummary} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>AI Calling</h2>
        <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "4px 0 0" }}>
          Outbound dial performance — bookings, answers, and misses
        </p>
      </div>

      {/* Performance strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <PerfCard
          label="Bookings made"
          value={stats.booked}
          hint={`${stats.bookingRate}% of answered`}
          color={COLORS.green}
          emphasize
        />
        <PerfCard label="Answered" value={stats.answered} hint="Connected dials" color={COLORS.blue} />
        <PerfCard label="No answer" value={stats.noAnswer} hint="Missed / ring-out" color={COLORS.textMuted} />
        <PerfCard label="Failed / busy" value={stats.failed} hint="Could not complete" color={COLORS.red} />
        <PerfCard label="Total dials" value={stats.total} hint={`Avg ${formatDuration(stats.avgDuration || 0)}`} color={COLORS.orange} />
      </div>

      {/* Outcome legend */}
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 16,
          padding: "10px 14px",
          borderRadius: 10,
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
        }}
      >
        <span style={{ fontSize: 11, color: COLORS.textMuted, alignSelf: "center", marginRight: 4 }}>Legend</span>
        {Object.entries(OUTCOME_META).map(([key, m]) => (
          <span key={key} style={S.badge(m.color)}>{m.short}</span>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            style={{
              ...S.btn(filter === f.id ? "primary" : "ghost"),
              padding: "7px 14px",
              fontSize: 12,
            }}
          >
            {f.label}
          </button>
        ))}
        <button type="button" style={{ ...S.btn("ghost"), padding: "7px 14px", fontSize: 12, marginLeft: "auto" }} onClick={() => fetchData()}>
          Refresh
        </button>
      </div>

      <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
        {filteredSessions.length === 0 ? (
          <div style={{ textAlign: "center", color: COLORS.textMuted, padding: 48, fontSize: 13 }}>
            No calls in this filter yet.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ ...S.table, margin: 0 }}>
              <thead>
                <tr>
                  <th style={S.th}>When</th>
                  <th style={S.th}>Lead</th>
                  <th style={S.th}>Result</th>
                  <th style={S.th}>Booking</th>
                  <th style={S.th}>Duration</th>
                  <th style={S.th}></th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.map((s) => {
                  const meta = outcomeMeta(s.outcome);
                  const success = isSuccessful(s.outcome);
                  return (
                    <tr
                      key={s.id}
                      style={{ cursor: "pointer" }}
                      onClick={() => openSession(s)}
                      onMouseEnter={(e) => { e.currentTarget.style.background = COLORS.surfaceAlt; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <td style={S.td}>
                        <div style={{ fontSize: 13 }}>{s.startedAt ? new Date(s.startedAt).toLocaleString() : "—"}</div>
                      </td>
                      <td style={S.td}>
                        <div style={{ fontWeight: 650 }}>{s.leadName || "—"}</div>
                        <div style={{ fontSize: 11, color: COLORS.textMuted }}>{s.leadPhone || ""}</div>
                      </td>
                      <td style={S.td}>
                        <span style={S.badge(meta.color)}>{meta.label}</span>
                      </td>
                      <td style={S.td}>
                        {s.outcome === "booked" ? (
                          <span style={{ color: COLORS.green, fontWeight: 650, fontSize: 13 }}>Yes</span>
                        ) : success ? (
                          <span style={{ color: COLORS.textMuted, fontSize: 13 }}>No</span>
                        ) : (
                          <span style={{ color: COLORS.textDim, fontSize: 13 }}>—</span>
                        )}
                      </td>
                      <td style={S.td}>{formatDuration(s.durationSeconds)}</td>
                      <td style={S.td}>
                        <button
                          type="button"
                          style={{ ...S.btn("ghost"), padding: "4px 12px", fontSize: 12 }}
                          onClick={(e) => { e.stopPropagation(); openSession(s); }}
                        >
                          Details →
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
    </div>
  );
}

function PerfCard({ label, value, hint, color, emphasize }) {
  return (
    <div
      style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 12,
        padding: "16px 18px",
        borderLeft: `3px solid ${color}`,
        boxShadow: emphasize ? `0 0 0 1px ${color}22` : "none",
      }}
    >
      <div style={{ fontSize: 11, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.45, marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 750, color, lineHeight: 1 }}>{value ?? "—"}</div>
      {hint && <div style={{ fontSize: 11, color: COLORS.textDim, marginTop: 8 }}>{hint}</div>}
    </div>
  );
}

function MiniStat({ label, value, accent }) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 8, background: COLORS.surfaceAlt, border: `1px solid ${COLORS.border}` }}>
      <div style={{ fontSize: 10, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 650, marginTop: 4, color: accent || COLORS.text, textTransform: "capitalize" }}>{value}</div>
    </div>
  );
}
