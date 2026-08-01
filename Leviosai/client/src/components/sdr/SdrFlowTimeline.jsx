import { COLORS, S } from "../../theme.js";

export const STEP_LABELS = {
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
  sms_failed: "SMS Send Failed",
  sms_conversation: "SMS Conversation",
  sms_ai_reply: "AI SMS Reply Sent",
  email_sent: "Email Follow-up Sent",
  email_replied: "Lead Replied to Email",
  email_timeout: "Email Timeout — No Reply",
  email_failed: "Email Send Failed",
  email_ai_reply: "AI Email Reply Sent",
  exhausted: "Sequence Exhausted — No Response",
  re_enrolled: "Re-enrolled in Sequence",
  stuck_recovery: "Recovered from Stuck State",
};

export const STEP_ICONS = {
  pending: "🚀",
  call_initiated: "📞",
  call_connected: "✅",
  call_no_answer: "📵",
  call_busy: "📳",
  call_failed: "⚠️",
  call_answered: "🗣️",
  booked: "📅",
  sms_sent: "💬",
  sms_replied: "↩️",
  sms_timeout: "⏱️",
  sms_failed: "⚠️",
  sms_conversation: "💬",
  sms_ai_reply: "🤖",
  email_sent: "✉️",
  email_replied: "↩️",
  email_timeout: "⏱️",
  email_failed: "⚠️",
  email_ai_reply: "🤖",
  exhausted: "🔚",
  re_enrolled: "🔁",
  stuck_recovery: "🔧",
};

export const STATUS_COLORS = {
  pending: COLORS.yellow,
  call_initiated: COLORS.blue,
  call_connected: COLORS.teal,
  call_no_answer: COLORS.textMuted,
  call_busy: COLORS.orange,
  call_failed: COLORS.red,
  call_answered: COLORS.blue,
  sms_sent: COLORS.orange,
  sms_replied: COLORS.green,
  sms_timeout: COLORS.red,
  sms_failed: COLORS.red,
  sms_conversation: COLORS.teal,
  sms_ai_reply: COLORS.teal,
  email_sent: COLORS.purple,
  email_replied: COLORS.green,
  email_timeout: COLORS.red,
  email_failed: COLORS.red,
  email_ai_reply: COLORS.teal,
  booked: COLORS.green,
  exhausted: COLORS.red,
  re_enrolled: COLORS.teal,
  stuck_recovery: COLORS.teal,
};

function payloadDetails(payload) {
  if (!payload || typeof payload !== "object") return [];
  const rows = [];
  if (payload.from) rows.push(["From", payload.from]);
  if (payload.to) rows.push(["To", payload.to]);
  if (payload.subject || payload.replySubject) rows.push(["Subject", payload.subject || payload.replySubject]);
  if (payload.body) rows.push(["Message", payload.body]);
  if (payload.replyText) rows.push(["Reply", payload.replyText]);
  if (payload.smsSid) rows.push(["SMS SID", payload.smsSid]);
  if (payload.emailId) rows.push(["Email ID", payload.emailId]);
  if (payload.messageSid) rows.push(["Message SID", payload.messageSid]);
  if (payload.sessionId) rows.push(["Call session", payload.sessionId]);
  if (payload.outcome) rows.push(["Outcome", payload.outcome]);
  if (payload.error) rows.push(["Error", payload.error]);
  if (payload.reason) rows.push(["Reason", payload.reason]);
  return rows;
}

function CallSessionCard({ session }) {
  return (
    <div
      style={{
        marginTop: 8,
        padding: 12,
        borderRadius: 8,
        background: COLORS.surfaceAlt,
        border: `1px solid ${COLORS.border}`,
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 650, marginBottom: 6 }}>
        Call session · {session.status || "—"}
        {session.outcome ? ` · ${session.outcome}` : ""}
        {session.durationSeconds != null ? ` · ${session.durationSeconds}s` : ""}
      </div>
      {session.twilioCallSid && (
        <div style={{ color: COLORS.textMuted, marginBottom: 4, fontFamily: "monospace", fontSize: 11 }}>
          {session.twilioCallSid}
        </div>
      )}
      {session.aiSummary && (
        <div style={{ color: COLORS.textMuted, lineHeight: 1.45, marginBottom: 6 }}>
          <strong style={{ color: COLORS.text }}>Summary:</strong> {session.aiSummary}
        </div>
      )}
      {session.transcript && (
        <details>
          <summary style={{ cursor: "pointer", color: COLORS.orange, fontWeight: 600 }}>Transcript</summary>
          <pre
            style={{
              marginTop: 8,
              whiteSpace: "pre-wrap",
              fontSize: 11,
              lineHeight: 1.45,
              color: COLORS.textMuted,
              maxHeight: 220,
              overflow: "auto",
            }}
          >
            {session.transcript}
          </pre>
        </details>
      )}
      {session.recordingUrl && (
        <a href={session.recordingUrl} target="_blank" rel="noreferrer" style={{ color: COLORS.teal, fontSize: 12 }}>
          Open recording →
        </a>
      )}
    </div>
  );
}

function MessageBubble({ msg }) {
  const inbound = msg.direction === "inbound";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: inbound ? "flex-start" : "flex-end",
        marginBottom: 8,
      }}
    >
      <div
        style={{
          maxWidth: "85%",
          padding: "10px 12px",
          borderRadius: 10,
          background: inbound ? COLORS.surfaceAlt : `${COLORS.orange}14`,
          border: `1px solid ${inbound ? COLORS.border : `${COLORS.orange}44`}`,
        }}
      >
        <div style={{ fontSize: 10, color: COLORS.textMuted, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 }}>
          {msg.channel} · {msg.direction}
          {msg.aiGenerated ? " · AI" : ""}
          {" · "}
          {msg.createdAt ? new Date(msg.createdAt).toLocaleString() : ""}
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{msg.content}</div>
      </div>
    </div>
  );
}

/**
 * Full SDR flow display: step timeline + message thread + call sessions.
 */
export function SdrFlowTimeline({ logs = [], messages = [], callSessions = [] }) {
  const sessionsById = Object.fromEntries((callSessions || []).map((s) => [s.id, s]));

  return (
    <div>
      {(logs || []).length === 0 && (messages || []).length === 0 ? (
        <div style={{ textAlign: "center", color: COLORS.textMuted, padding: "30px 0", fontSize: 13 }}>
          No SDR activity yet for this lead.
        </div>
      ) : (
        <>
          {(logs || []).length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 12, fontWeight: 650, color: COLORS.textMuted, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Sequence timeline
              </div>
              <div style={{ position: "relative", paddingLeft: 4 }}>
                <div style={{ position: "absolute", left: 15, top: 8, bottom: 8, width: 2, background: COLORS.border }} />
                {logs.map((log) => {
                  const details = payloadDetails(log.payload);
                  const session =
                    log.payload?.sessionId ? sessionsById[log.payload.sessionId] : null;
                  return (
                    <div key={log.id} style={{ display: "flex", gap: 14, marginBottom: 16, position: "relative" }}>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 16,
                          background: COLORS.surface,
                          border: `2px solid ${COLORS.border}`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 14,
                          flexShrink: 0,
                          zIndex: 1,
                        }}
                      >
                        {STEP_ICONS[log.stepName] || "•"}
                      </div>
                      <div style={{ flex: 1, paddingTop: 5, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          {STEP_LABELS[log.stepName] || log.stepName}
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
                        {details.length > 0 && (
                          <div
                            style={{
                              marginTop: 8,
                              padding: 10,
                              borderRadius: 8,
                              background: COLORS.surfaceAlt,
                              border: `1px solid ${COLORS.border}`,
                              display: "grid",
                              gap: 6,
                            }}
                          >
                            {details.map(([label, value]) => (
                              <div key={label} style={{ fontSize: 12, lineHeight: 1.45 }}>
                                <span style={{ color: COLORS.textMuted }}>{label}: </span>
                                <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{String(value)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {session && <CallSessionCard session={session} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(messages || []).length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 650, color: COLORS.textMuted, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Messages (SMS / Email)
              </div>
              <div
                style={{
                  padding: 14,
                  borderRadius: 10,
                  border: `1px solid ${COLORS.border}`,
                  background: COLORS.bg || "transparent",
                  maxHeight: 420,
                  overflowY: "auto",
                }}
              >
                {messages.map((m) => (
                  <MessageBubble key={m.id} msg={m} />
                ))}
              </div>
            </div>
          )}

          {(callSessions || []).length > 0 && (logs || []).every((l) => !l.payload?.sessionId) && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 650, color: COLORS.textMuted, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Call sessions
              </div>
              {callSessions.map((s) => (
                <CallSessionCard key={s.id} session={s} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
