import { useEffect, useState } from "react";
import { COLORS, S } from "../../theme.js";
import { sdrApi } from "../../api.js";

const STEP_LABELS = {
  pending: "Enrolled — Awaiting First Contact",
  call_initiated: "AI Call Initiated",
  call_connected: "Call Connected",
  call_no_answer: "Call Outcome: No Answer",
  call_busy: "Call Busy — Retry Scheduled",
  call_failed: "Call Failed",
  call_answered: "Call Answered",
  booked: "Appointment Booked",
  sms_sent: "SMS Follow-up Sent",
  sms_replied: "Lead Replied to SMS",
  sms_timeout: "SMS Timeout — No Reply",
  email_sent: "Email Follow-up Sent",
  email_replied: "Lead Replied to Email",
  email_timeout: "Email Timeout — No Reply",
  exhausted: "Sequence Exhausted — No Response",
  re_enrolled: "Re-enrolled in Sequence",
  stuck_recovery: "Recovered from Stuck State",
};

const STEP_ICONS = {
  pending: "🚀", call_initiated: "📞", call_connected: "✅", call_no_answer: "📵",
  call_busy: "📳", call_failed: "⚠️", call_answered: "🗣️", booked: "📅",
  sms_sent: "💬", sms_replied: "↩️", sms_timeout: "⏱️",
  email_sent: "✉️", email_replied: "↩️", email_timeout: "⏱️",
  exhausted: "🔚", re_enrolled: "🔁", stuck_recovery: "🔧",
};

const STATUS_COLORS = {
  pending: COLORS.yellow, call_initiated: COLORS.blue, call_connected: COLORS.teal,
  call_no_answer: COLORS.textMuted, call_busy: COLORS.orange, call_failed: COLORS.red,
  call_answered: COLORS.blue, sms_sent: COLORS.orange, sms_replied: COLORS.green,
  sms_timeout: COLORS.red, email_sent: COLORS.purple, email_replied: COLORS.green,
  email_timeout: COLORS.red, booked: COLORS.green, exhausted: COLORS.red,
  re_enrolled: COLORS.teal, stuck_recovery: COLORS.teal,
};

/** Per-lead SDR execution timeline + enroll CTA (plan §10.3 / §13.3). */
export function ExecutionLogTable({ leadId }) {
  const [logs, setLogs] = useState([]);
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

      {logs.length === 0 ? (
        <div style={{ textAlign: "center", color: COLORS.textMuted, padding: "30px 0", fontSize: 13 }}>
          No SDR activity yet for this lead.
        </div>
      ) : (
        <div style={{ position: "relative", paddingLeft: 4 }}>
          <div style={{ position: "absolute", left: 15, top: 8, bottom: 8, width: 2, background: COLORS.border }} />
          {logs.map((log) => (
            <div key={log.id} style={{ display: "flex", gap: 14, marginBottom: 16, position: "relative" }}>
              <div style={{ width: 32, height: 32, borderRadius: 16, background: COLORS.surface, border: `2px solid ${COLORS.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0, zIndex: 1 }}>
                {STEP_ICONS[log.stepName] || "•"}
              </div>
              <div style={{ flex: 1, paddingTop: 5 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  Step {log.step} — {STEP_LABELS[log.stepName] || log.stepName}
                </div>
                <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span>{new Date(log.loggedAt).toLocaleString()}</span>
                  {log.outcome && (
                    <span style={S.badge(STATUS_COLORS[log.outcome] || COLORS.textMuted)}>{log.outcome}</span>
                  )}
                </div>
                {log.errorMessage && (
                  <div style={{ fontSize: 12, color: COLORS.red, marginTop: 4 }}>⚠ {log.errorMessage}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
