import { useEffect, useState } from "react";
import { COLORS, S } from "../../theme.js";
import { sdrApi } from "../../api.js";
import { SdrFlowTimeline, STATUS_COLORS } from "./SdrFlowTimeline.jsx";

/** Per-lead SDR execution timeline + enroll CTA (plan §10.3 / §13.3). */
export function ExecutionLogTable({ leadId }) {
  const [logs, setLogs] = useState([]);
  const [messages, setMessages] = useState([]);
  const [callSessions, setCallSessions] = useState([]);
  const [enrollment, setEnrollment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    sdrApi.getLeadLogs(leadId)
      .then((data) => {
        setLogs(data.logs || []);
        setMessages(data.messages || []);
        setCallSessions(data.callSessions || []);
        setEnrollment(data.enrollment || null);
      })
      .catch((e) => setError(e.message || "Failed to load SDR history"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [leadId]);

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

  if (loading) {
    return <div style={{ padding: 20, textAlign: "center", color: COLORS.textMuted }}>Loading SDR history…</div>;
  }

  return (
    <div style={{ paddingTop: 16 }}>
      {error && (
        <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 8, background: `${COLORS.red}18`, border: `1px solid ${COLORS.red}44`, color: COLORS.red, fontSize: 13 }}>
          {error}
        </div>
      )}

      {enrollment ? (
        <div style={{ padding: "12px 16px", borderRadius: 10, background: COLORS.surfaceAlt, border: `1px solid ${COLORS.border}`, marginBottom: 20, display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Current Enrollment
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={S.badge(STATUS_COLORS[enrollment.status] || COLORS.textMuted)}>{enrollment.status}</span>
              <span style={{ fontSize: 12, color: COLORS.textMuted }}>Step {enrollment.currentStep}</span>
              <span style={{ fontSize: 12, color: COLORS.textMuted }}>·</span>
              <span style={{ fontSize: 12, color: COLORS.textMuted }}>
                Enrolled {new Date(enrollment.enrolledAt).toLocaleDateString()}
              </span>
              {enrollment.callAttempts > 0 && (
                <span style={{ fontSize: 12, color: COLORS.textMuted }}>· {enrollment.callAttempts} call attempt{enrollment.callAttempts === 1 ? "" : "s"}</span>
              )}
              {enrollment.smsSentAt && (
                <span style={{ fontSize: 12, color: COLORS.textMuted }}>· SMS {new Date(enrollment.smsSentAt).toLocaleString()}</span>
              )}
              {enrollment.emailSentAt && (
                <span style={{ fontSize: 12, color: COLORS.textMuted }}>· Email {new Date(enrollment.emailSentAt).toLocaleString()}</span>
              )}
            </div>
          </div>
          <button type="button" style={{ ...S.btn("ghost"), padding: "6px 12px", fontSize: 12 }} onClick={load}>
            Refresh
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderRadius: 10, background: COLORS.surfaceAlt, border: `1px solid ${COLORS.border}`, marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: COLORS.textMuted }}>Not currently enrolled in the SDR sequence.</span>
          <button type="button" style={{ ...S.btn("primary"), padding: "8px 16px", fontSize: 12 }} onClick={handleEnroll} disabled={enrolling}>
            {enrolling ? "Enrolling…" : "Enroll in SDR"}
          </button>
        </div>
      )}

      <SdrFlowTimeline logs={logs} messages={messages} callSessions={callSessions} />
    </div>
  );
}
