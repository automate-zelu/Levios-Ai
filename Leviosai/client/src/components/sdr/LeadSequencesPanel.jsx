import { useEffect, useMemo, useState } from "react";
import { COLORS, S } from "../../theme.js";
import { sdrApi } from "../../api.js";
import {
  SdrFlowTimeline,
  STATUS_COLORS,
  groupLogsByDial,
  sliceDialFlow,
  stepTitle,
} from "./SdrFlowTimeline.jsx";

/**
 * Lead detail → Sequences: tabular dials; click a row for a spacious flow modal.
 */
export function LeadSequencesPanel({ lead, onNavigate }) {
  const leadId = lead?.id;
  const [logs, setLogs] = useState([]);
  const [messages, setMessages] = useState([]);
  const [callSessions, setCallSessions] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [enrollment, setEnrollment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [error, setError] = useState("");
  const [tryIndex, setTryIndex] = useState(0);
  const [selectedDial, setSelectedDial] = useState(null);

  const load = () => {
    if (!leadId) return;
    setLoading(true);
    setError("");
    sdrApi
      .getLeadLogs(leadId)
      .then((data) => {
        setLogs(data.logs || []);
        setMessages(data.messages || []);
        setCallSessions(data.callSessions || []);
        const list = data.enrollments?.length
          ? data.enrollments
          : data.enrollment
            ? [data.enrollment]
            : [];
        setEnrollments(list);
        setEnrollment(list[0] || null);
        setTryIndex(0);
        setSelectedDial(null);
      })
      .catch((e) => setError(e.message || "Failed to load sequences"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [leadId]);

  const activeEnrollment = enrollments[tryIndex] || enrollment;

  const enrollmentLogs = useMemo(() => {
    if (!activeEnrollment) return logs.filter((l) => l.stepName !== "stuck_recovery");
    return (logs || []).filter(
      (l) => l.enrollmentId === activeEnrollment.id && l.stepName !== "stuck_recovery"
    );
  }, [logs, activeEnrollment]);

  const enrollmentSessions = useMemo(() => {
    if (!activeEnrollment) return callSessions;
    return (callSessions || []).filter((s) => s.enrollmentId === activeEnrollment.id);
  }, [callSessions, activeEnrollment]);

  const dialGroups = useMemo(
    () => groupLogsByDial(enrollmentLogs, enrollmentSessions),
    [enrollmentLogs, enrollmentSessions]
  );

  const rows = useMemo(() => {
    return [...dialGroups].reverse().map((g) => {
      const last = g.logs[g.logs.length - 1];
      const outcome =
        g.session?.outcome ||
        last?.outcome ||
        last?.stepName ||
        "—";
      const outcomeLabel = String(outcome).replace(/_/g, " ");
      return {
        group: g,
        dial: g.label,
        startedAt: g.startedAt || g.session?.startedAt,
        outcome: outcomeLabel,
        status: g.session?.status || activeEnrollment?.status || "—",
        duration:
          g.session?.durationSeconds != null ? `${g.session.durationSeconds}s` : "—",
        steps: g.logs.length,
        lastStep: last ? stepTitle(last) : "—",
        lastAt: last?.loggedAt,
      };
    });
  }, [dialGroups, activeEnrollment]);

  const dialDetail = useMemo(() => {
    if (!selectedDial) return null;
    const g = selectedDial;
    if (g.session) {
      return {
        ...sliceDialFlow({ logs: enrollmentLogs, messages, session: g.session }),
        callSessions: [g.session],
        label: g.label,
      };
    }
    return {
      logs: g.logs,
      messages,
      callSessions: enrollmentSessions,
      label: g.label,
    };
  }, [selectedDial, enrollmentLogs, messages, enrollmentSessions]);

  const handleEnroll = async () => {
    setEnrolling(true);
    setError("");
    try {
      await sdrApi.enrollLead(leadId);
      load();
    } catch (e) {
      setError(e.message || "Enrollment failed");
    } finally {
      setEnrolling(false);
    }
  };

  const openInbox = (channel) => {
    try {
      sessionStorage.setItem("inboxFocusLeadId", String(leadId));
    } catch { /* ignore */ }
    onNavigate?.(channel === "sms" ? "SMS Inbox" : "Email Inbox");
  };

  if (loading) {
    return <div style={{ padding: 20, textAlign: "center", color: COLORS.textMuted }}>Loading sequences…</div>;
  }

  return (
    <div style={{ paddingTop: 8 }}>
      {error && (
        <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 8, background: `${COLORS.red}18`, color: COLORS.red, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div
        style={{
          padding: "16px 20px",
          borderRadius: 12,
          background: COLORS.surfaceAlt,
          border: `1px solid ${COLORS.border}`,
          marginBottom: 18,
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 11, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
            SDR sequences
          </div>
          {activeEnrollment ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={S.badge(STATUS_COLORS[activeEnrollment.status] || COLORS.textMuted)}>
                {activeEnrollment.status}
              </span>
              <span style={{ fontSize: 12, color: COLORS.textMuted }}>
                Started {new Date(activeEnrollment.enrolledAt).toLocaleDateString()}
              </span>
            </div>
          ) : (
            <span style={{ fontSize: 13, color: COLORS.textMuted }}>Not enrolled yet</span>
          )}
        </div>
        <button type="button" style={{ ...S.btn("ghost"), padding: "8px 14px", fontSize: 12 }} onClick={load}>
          Refresh
        </button>
        <button type="button" style={{ ...S.btn("primary"), padding: "8px 16px", fontSize: 12 }} onClick={handleEnroll} disabled={enrolling}>
          {enrolling ? "Starting…" : activeEnrollment ? "Start new try" : "Enroll in SDR"}
        </button>
      </div>

      {enrollments.length > 1 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {enrollments.map((e, i) => {
            const active = i === tryIndex;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => { setTryIndex(i); setSelectedDial(null); }}
                style={{
                  ...S.btn(active ? "primary" : "ghost"),
                  padding: "8px 14px",
                  fontSize: 12,
                }}
              >
                Try {enrollments.length - i}
                <span style={{ opacity: 0.75, marginLeft: 6, fontWeight: 500 }}>
                  {new Date(e.enrolledAt).toLocaleDateString()}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {!activeEnrollment && logs.length === 0 ? (
        <div style={{ textAlign: "center", color: COLORS.textMuted, padding: 48, fontSize: 13 }}>
          No sequence history yet. Enroll this lead to start call → SMS → email.
        </div>
      ) : rows.length === 0 ? (
        <div style={{ textAlign: "center", color: COLORS.textMuted, padding: 48, fontSize: 13 }}>
          Enrolled, but no dials recorded yet.
        </div>
      ) : (
        <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
          <div className="table-responsive">
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Dial</th>
                  <th style={S.th}>Started</th>
                  <th style={S.th}>Outcome</th>
                  <th style={S.th} className="hide-mobile">Duration</th>
                  <th style={S.th} className="hide-mobile">Steps</th>
                  <th style={S.th}>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.group.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => setSelectedDial(row.group)}
                    onMouseEnter={(e) => { e.currentTarget.style.background = COLORS.surfaceAlt; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <td style={{ ...S.td, fontWeight: 650 }}>{row.dial}</td>
                    <td style={S.td}>
                      <span style={{ fontSize: 12, color: COLORS.textMuted }}>
                        {row.startedAt ? new Date(row.startedAt).toLocaleString() : "—"}
                      </span>
                    </td>
                    <td style={S.td}>
                      <span style={S.badge(outcomeColor(row.outcome))}>{row.outcome}</span>
                    </td>
                    <td style={S.td} className="hide-mobile">{row.duration}</td>
                    <td style={S.td} className="hide-mobile">{row.steps}</td>
                    <td style={S.td}>
                      <div style={{ fontSize: 13 }}>{row.lastStep}</div>
                      <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>
                        {row.lastAt ? new Date(row.lastAt).toLocaleString() : ""}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "12px 18px", fontSize: 12, color: COLORS.textMuted, borderTop: `1px solid ${COLORS.border}` }}>
            Click a dial to open the full sequence for that attempt.
          </div>
        </div>
      )}

      {dialDetail && selectedDial && (
        <DialDetailModal
          label={dialDetail.label}
          enrollmentStatus={activeEnrollment?.status}
          logs={dialDetail.logs}
          messages={dialDetail.messages}
          callSessions={dialDetail.callSessions}
          onClose={() => setSelectedDial(null)}
          onStepClick={openInbox}
        />
      )}
    </div>
  );
}

function outcomeColor(outcome) {
  const o = String(outcome || "").toLowerCase();
  if (o.includes("book") || o.includes("answer") || o.includes("replied") || o.includes("agree")) return COLORS.green;
  if (o.includes("no answer") || o.includes("timeout") || o.includes("busy")) return COLORS.yellow;
  if (o.includes("fail") || o.includes("exhaust") || o.includes("declin")) return COLORS.red;
  if (o.includes("sms")) return COLORS.orange;
  if (o.includes("email")) return COLORS.purple;
  return COLORS.blue;
}

function DialDetailModal({ label, enrollmentStatus, logs, messages, callSessions, onClose, onStepClick }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${label} sequence`}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1200,
        backdropFilter: "blur(4px)",
        padding: 28,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(960px, 100%)",
          height: "min(820px, 90vh)",
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 18,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 28px 90px rgba(0,0,0,0.55)",
        }}
      >
        <div
          style={{
            padding: "22px 28px",
            borderBottom: `1px solid ${COLORS.border}`,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
              Sequence detail
            </div>
            <div style={{ fontSize: 20, fontWeight: 750, marginBottom: 8 }}>{label}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {enrollmentStatus && (
                <span style={S.badge(STATUS_COLORS[enrollmentStatus] || COLORS.textMuted)}>
                  {enrollmentStatus}
                </span>
              )}
              <span style={{ fontSize: 12, color: COLORS.textMuted }}>
                {(logs || []).length} steps
                {(messages || []).length ? ` · ${(messages || []).length} related messages` : ""}
              </span>
            </div>
          </div>
          <button type="button" style={{ ...S.btn("ghost"), padding: "10px 14px" }} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "28px 32px 36px",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <SdrFlowTimeline
            title={`${label} flow`}
            logs={logs}
            messages={messages}
            hideMessages={!(messages || []).length}
            callSessions={callSessions}
            onStepClick={onStepClick}
          />
        </div>
      </div>
    </div>
  );
}
