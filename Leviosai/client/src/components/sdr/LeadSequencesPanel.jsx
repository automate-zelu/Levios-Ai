import { useEffect, useMemo, useState } from "react";
import { COLORS, S } from "../../theme.js";
import { sdrApi } from "../../api.js";
import {
  SdrFlowTimeline,
  STATUS_COLORS,
  groupLogsByDial,
  sliceDialFlow,
} from "./SdrFlowTimeline.jsx";
import { ConversationThreadModal } from "./ConversationThreadModal.jsx";

/**
 * Lead detail → Sequences: every enrollment try + dial attempts,
 * with SMS/email conversation modals and inbox deep-links.
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
  const [dialIndex, setDialIndex] = useState(-1);
  const [threadModal, setThreadModal] = useState(null); // { channel }

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
        setDialIndex(-1);
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

  const activeDial = useMemo(() => {
    if (!dialGroups.length) return null;
    const idx = dialIndex < 0 ? dialGroups.length - 1 : Math.min(dialIndex, dialGroups.length - 1);
    return dialGroups[idx];
  }, [dialGroups, dialIndex]);

  const dialView = useMemo(() => {
    if (!activeDial) {
      return { logs: enrollmentLogs, messages, callSessions: enrollmentSessions };
    }
    if (activeDial.session) {
      return {
        ...sliceDialFlow({ logs: enrollmentLogs, messages, session: activeDial.session }),
        callSessions: [activeDial.session],
      };
    }
    return { logs: activeDial.logs, messages, callSessions: enrollmentSessions };
  }, [activeDial, enrollmentLogs, messages, enrollmentSessions]);

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
    setThreadModal(null);
    onNavigate?.(channel === "sms" ? "SMS Inbox" : "Email Inbox");
  };

  const leadName = lead?.name || [lead?.firstName, lead?.lastName].filter(Boolean).join(" ") || "Lead";

  if (loading) {
    return <div style={{ padding: 20, textAlign: "center", color: COLORS.textMuted }}>Loading sequences…</div>;
  }

  return (
    <div style={{ paddingTop: 16 }}>
      {error && (
        <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 8, background: `${COLORS.red}18`, color: COLORS.red, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div
        style={{
          padding: "12px 16px",
          borderRadius: 10,
          background: COLORS.surfaceAlt,
          border: `1px solid ${COLORS.border}`,
          marginBottom: 16,
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
        <button type="button" style={{ ...S.btn("ghost"), padding: "6px 12px", fontSize: 12 }} onClick={load}>
          Refresh
        </button>
        <button type="button" style={{ ...S.btn("primary"), padding: "8px 14px", fontSize: 12 }} onClick={handleEnroll} disabled={enrolling}>
          {enrolling ? "Starting…" : activeEnrollment ? "Start new try" : "Enroll in SDR"}
        </button>
      </div>

      {enrollments.length > 1 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {enrollments.map((e, i) => {
            const active = i === tryIndex;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => { setTryIndex(i); setDialIndex(-1); }}
                style={{
                  ...S.btn(active ? "primary" : "ghost"),
                  padding: "6px 12px",
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

      {dialGroups.length > 1 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {dialGroups.map((g, i) => {
            const active = (dialIndex < 0 ? dialGroups.length - 1 : dialIndex) === i;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setDialIndex(i)}
                style={{
                  ...S.btn(active ? "secondary" : "ghost"),
                  padding: "6px 12px",
                  fontSize: 12,
                  borderColor: active ? COLORS.orange : undefined,
                }}
              >
                {g.label}
                {g.session?.outcome ? (
                  <span style={{ marginLeft: 6, textTransform: "capitalize", opacity: 0.85 }}>
                    · {String(g.session.outcome).replace(/_/g, " ")}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {!activeEnrollment && logs.length === 0 ? (
        <div style={{ textAlign: "center", color: COLORS.textMuted, padding: 40, fontSize: 13 }}>
          No sequence history yet. Enroll this lead to start call → SMS → email.
        </div>
      ) : (
        <SdrFlowTimeline
          title={activeDial ? `${activeDial.label} flow` : "Sequence flow"}
          logs={dialView.logs}
          messages={[]}
          hideMessages
          callSessions={dialView.callSessions}
          onStepClick={(channel) => setThreadModal({ channel })}
        />
      )}

      {threadModal && (
        <ConversationThreadModal
          channel={threadModal.channel}
          leadName={leadName}
          leadPhone={lead?.phone}
          leadEmail={lead?.email}
          messages={messages}
          onClose={() => setThreadModal(null)}
          onOpenInbox={openInbox}
        />
      )}
    </div>
  );
}
