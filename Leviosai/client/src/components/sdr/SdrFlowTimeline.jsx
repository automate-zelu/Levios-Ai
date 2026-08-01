import { COLORS, S } from "../../theme.js";
import { parseEmailContent } from "../../lib/emailMessage.js";

export const STEP_LABELS = {
  pending: "Enrolled — Awaiting First Contact",
  call_initiated: "AI Call Dialed",
  call_connected: "Call Connected",
  call_no_answer: "No Answer",
  call_busy: "Line Busy — Retry Scheduled",
  call_failed: "Call Failed",
  call_answered: "Call Answered",
  booked: "Appointment Booked",
  sms_sent: "SMS Follow-up Sent",
  sms_replied: "Lead Replied via SMS",
  sms_timeout: "SMS — No Reply in Time",
  sms_failed: "SMS Send Failed",
  sms_conversation: "Lead Sent an SMS",
  sms_ai_reply: "AI Replied via SMS",
  email_sent: "Email Follow-up Sent",
  email_replied: "Lead Replied via Email",
  email_timeout: "Email — No Reply in Time",
  email_failed: "Email Send Failed",
  email_ai_reply: "AI Replied via Email",
  exhausted: "Sequence Exhausted",
  re_enrolled: "Re-enrolled in Sequence",
  stuck_recovery: "Sequence Recovered",
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
  sms_timeout: COLORS.textMuted,
  sms_failed: COLORS.red,
  sms_conversation: COLORS.teal,
  sms_ai_reply: COLORS.teal,
  email_sent: COLORS.purple,
  email_replied: COLORS.green,
  email_timeout: COLORS.textMuted,
  email_failed: COLORS.red,
  email_ai_reply: COLORS.teal,
  booked: COLORS.green,
  exhausted: COLORS.red,
  re_enrolled: COLORS.teal,
  stuck_recovery: COLORS.teal,
};

const OUTCOME_LABELS = {
  no_reply: "No reply",
  sms_replied: "SMS reply",
  email_replied: "Email reply",
  call_no_answer: "No answer",
  call_initiated: "Dialed",
  call_connected: "Connected",
  email_sent: "Email sent",
  sms_sent: "SMS sent",
  booked: "Booked",
  agree: "Agreed",
  disagree: "Declined",
  question: "Question",
  other: "Other",
  sms_timeout: "Timed out",
  email_timeout: "Timed out",
};

function humanOutcome(outcome) {
  if (!outcome) return null;
  return OUTCOME_LABELS[outcome] || String(outcome).replace(/_/g, " ");
}

/** Resolve display title — channel-aware so SMS replies aren't labeled as email. */
export function stepTitle(log) {
  const payload = log?.payload || {};
  const channel = String(payload.channel || "").toLowerCase();
  const via = String(payload.via || "").toLowerCase();
  const name = log?.stepName || "";

  if (name === "email_replied" && (channel === "sms" || via === "sms_after_email")) {
    return "Lead Replied via SMS";
  }
  if (name === "sms_replied" && via === "sms_after_email") {
    return "Lead Replied via SMS";
  }
  if (name === "email_ai_reply" && channel === "sms") return "AI Replied via SMS";
  if (name === "sms_ai_reply") return STEP_LABELS.sms_ai_reply;
  if (name === "booked" && channel === "sms") return "Booked from SMS Reply";
  if (name === "booked" && channel === "email") return "Booked from Email Reply";
  return STEP_LABELS[name] || name.replace(/_/g, " ");
}

function stepIcon(log) {
  const payload = log?.payload || {};
  const channel = String(payload.channel || "").toLowerCase();
  const via = String(payload.via || "").toLowerCase();
  const name = log?.stepName || "";
  if ((name === "email_replied" || name === "sms_replied") && (channel === "sms" || via === "sms_after_email")) {
    return STEP_ICONS.sms_replied;
  }
  return STEP_ICONS[name] || "•";
}

function stepColor(log) {
  const payload = log?.payload || {};
  const channel = String(payload.channel || "").toLowerCase();
  const via = String(payload.via || "").toLowerCase();
  const name = log?.stepName || "";
  if ((name === "email_replied" || name === "sms_replied") && (channel === "sms" || via === "sms_after_email")) {
    return STATUS_COLORS.sms_replied;
  }
  return STATUS_COLORS[name] || COLORS.textMuted;
}

/**
 * Human-facing detail rows only — never expose Twilio/Gmail/session IDs.
 */
function payloadDetails(log) {
  const payload = log?.payload;
  if (!payload || typeof payload !== "object") return [];
  const rows = [];
  const channel = String(payload.channel || "").toLowerCase();
  const name = log?.stepName || "";

  const isSmsStep =
    channel === "sms" ||
    name.startsWith("sms_") ||
    payload.via === "sms_after_email";

  if (payload.from && !isSmsStep) rows.push(["From", payload.from]);
  if (payload.from && isSmsStep) rows.push(["From", payload.from]);
  if (payload.to && !isSmsStep) rows.push(["To", payload.to]);
  if (payload.to && isSmsStep) rows.push(["To", payload.to]);

  if (payload.subject || payload.replySubject) {
    rows.push(["Subject", payload.subject || payload.replySubject]);
  }
  if (payload.body) rows.push(["Body", payload.body]);
  if (payload.replyText) rows.push(["Reply", payload.replyText]);

  if (payload.reason === "sms_timeout") rows.push(["Note", "No SMS reply before the wait window ended"]);
  else if (payload.reason === "email_timeout") rows.push(["Note", "No email reply before the wait window ended"]);
  else if (payload.reason && !String(payload.reason).includes("_via_")) {
    rows.push(["Note", String(payload.reason).replace(/_/g, " ")]);
  }

  if (payload.error) rows.push(["Error", payload.error]);
  if (payload.outcome && !["no_answer", "busy", "failed"].includes(payload.outcome)) {
    // skip redundant dial outcomes already shown as badge
  }

  // Intentionally omitted: smsSid, emailId, messageSid, sessionId, twilio SIDs
  return rows;
}

function CallSessionCard({ session, compact = false }) {
  const outcomeLabel = session.outcome
    ? String(session.outcome).replace(/_/g, " ")
    : null;
  return (
    <div
      style={{
        marginTop: compact ? 0 : 8,
        padding: 12,
        borderRadius: 8,
        background: COLORS.surfaceAlt,
        border: `1px solid ${COLORS.border}`,
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 650, marginBottom: 6, textTransform: "capitalize" }}>
        Dial result
        {session.status ? ` · ${session.status}` : ""}
        {outcomeLabel ? ` · ${outcomeLabel}` : ""}
        {session.durationSeconds != null ? ` · ${session.durationSeconds}s` : ""}
      </div>
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
  const isEmail = msg.channel === "email";
  const parsed = isEmail ? parseEmailContent(msg.content) : null;

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
          {isEmail ? "Email" : "SMS"} · {inbound ? "Inbound" : msg.aiGenerated ? "Outbound · AI" : "Outbound"}
          {" · "}
          {msg.createdAt ? new Date(msg.createdAt).toLocaleString() : ""}
        </div>
        {isEmail ? (
          <div>
            <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 2 }}>Subject</div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, lineHeight: 1.35 }}>
              {parsed.subject || "(no subject)"}
            </div>
            <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 2 }}>Body</div>
            <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
              {parsed.body || "(empty)"}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{msg.content}</div>
        )}
      </div>
    </div>
  );
}

function TimelineStep({ log, session, onStepClick }) {
  const details = payloadDetails(log);
  const title = stepTitle(log);
  const outcome = humanOutcome(log.outcome);
  const showOutcome =
    outcome &&
    !title.toLowerCase().includes(String(outcome).toLowerCase()) &&
    log.outcome !== log.stepName;

  const name = log?.stepName || "";
  const isSmsStep = name.startsWith("sms_");
  const isEmailStep = name.startsWith("email_");
  const clickable = onStepClick && (isSmsStep || isEmailStep);

  return (
    <div style={{ display: "flex", gap: 14, marginBottom: 16, position: "relative" }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          background: COLORS.surface,
          border: `2px solid ${stepColor(log)}55`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          flexShrink: 0,
          zIndex: 1,
        }}
      >
        {stepIcon(log)}
      </div>
      <div style={{ flex: 1, paddingTop: 5, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>{new Date(log.loggedAt).toLocaleString()}</span>
          {showOutcome && (
            <span style={S.badge(stepColor(log))}>{outcome}</span>
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
        {clickable && (
          <button
            type="button"
            onClick={() => onStepClick(isSmsStep ? "sms" : "email", log)}
            style={{
              ...S.btn("ghost"),
              marginTop: 8,
              padding: "6px 12px",
              fontSize: 12,
            }}
          >
            {isSmsStep ? "View SMS conversation" : "View email thread"} →
          </button>
        )}
        {session && <CallSessionCard session={session} />}
      </div>
    </div>
  );
}

/**
 * Full SDR flow display: step timeline + message thread + call sessions.
 * System recovery noise (stuck_recovery) is hidden by default.
 */
export function SdrFlowTimeline({
  logs = [],
  messages = [],
  callSessions = [],
  hideMessages = false,
  title = "Sequence timeline",
  includeSystemLogs = false,
  onStepClick,
}) {
  const sessionsById = Object.fromEntries((callSessions || []).map((s) => [s.id, s]));
  const visibleLogs = (logs || []).filter((l) => {
    if (includeSystemLogs) return true;
    if (l.stepName === "stuck_recovery") return false;
    if (l.payload?.reason === "stuck_recovery" && l.stepName !== "call_no_answer") {
      if (["call_initiated"].includes(l.stepName) && l.payload?.fromStatus) return false;
    }
    return true;
  });

  return (
    <div>
      {visibleLogs.length === 0 && (messages || []).length === 0 ? (
        <div style={{ textAlign: "center", color: COLORS.textMuted, padding: "30px 0", fontSize: 13 }}>
          No activity recorded for this dial yet.
        </div>
      ) : (
        <>
          {visibleLogs.length > 0 && (
            <div style={{ marginBottom: hideMessages ? 0 : 24 }}>
              <div style={{ fontSize: 12, fontWeight: 650, color: COLORS.textMuted, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {title}
              </div>
              <div style={{ position: "relative", paddingLeft: 4 }}>
                <div style={{ position: "absolute", left: 15, top: 8, bottom: 8, width: 2, background: COLORS.border }} />
                {visibleLogs.map((log) => (
                  <TimelineStep
                    key={log.id}
                    log={log}
                    session={log.payload?.sessionId ? sessionsById[log.payload.sessionId] : null}
                    onStepClick={onStepClick}
                  />
                ))}
              </div>
            </div>
          )}

          {!hideMessages && (messages || []).length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 650, color: COLORS.textMuted, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Messages
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

          {(callSessions || []).length > 0 && visibleLogs.every((l) => !l.payload?.sessionId) && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 650, color: COLORS.textMuted, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Dial details
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

/**
 * Split an enrollment's logs into separate dial attempts (newest last).
 * Ignores stuck_recovery rows.
 */
export function groupLogsByDial(logs = [], callSessions = []) {
  const sorted = [...(logs || [])]
    .filter((l) => l.stepName !== "stuck_recovery")
    .sort((a, b) => new Date(a.loggedAt).getTime() - new Date(b.loggedAt).getTime());

  const sessionsById = Object.fromEntries((callSessions || []).map((s) => [s.id, s]));
  const groups = [];
  let current = null;

  for (const log of sorted) {
    const startsDial =
      log.stepName === "call_initiated" ||
      log.stepName === "re_enrolled" ||
      (log.stepName === "pending" && !current);

    if (startsDial) {
      if (current) groups.push(current);
      const session = log.payload?.sessionId ? sessionsById[log.payload.sessionId] : null;
      current = {
        id: log.payload?.sessionId || log.id,
        startedAt: log.loggedAt,
        session,
        logs: [log],
      };
    } else if (current) {
      current.logs.push(log);
      if (log.payload?.sessionId && !current.session) {
        current.session = sessionsById[log.payload.sessionId] || current.session;
        current.id = log.payload.sessionId;
      }
    } else {
      current = {
        id: log.id,
        startedAt: log.loggedAt,
        session: null,
        logs: [log],
      };
    }
  }
  if (current) groups.push(current);

  return groups.map((g, i) => ({
    ...g,
    label: `Dial ${i + 1}`,
    index: i + 1,
  }));
}

/**
 * Slice enrollment logs/messages to the window belonging to one dial session.
 */
export function sliceDialFlow({ logs = [], messages = [], session }) {
  if (!session) return { logs: [], messages: [] };
  const sorted = [...(logs || [])].sort(
    (a, b) => new Date(a.loggedAt).getTime() - new Date(b.loggedAt).getTime()
  );

  const startIdx = sorted.findIndex(
    (l) =>
      l.stepName === "call_initiated" &&
      l.payload?.sessionId === session.id
  );

  let windowLogs;
  if (startIdx >= 0) {
    let endIdx = sorted.length;
    for (let i = startIdx + 1; i < sorted.length; i++) {
      if (
        sorted[i].stepName === "call_initiated" ||
        sorted[i].stepName === "re_enrolled"
      ) {
        endIdx = i;
        break;
      }
    }
    windowLogs = sorted.slice(startIdx, endIdx);
  } else {
    // Fallback: call-related logs referencing this session + nearby follow-ups by time
    const t0 = session.startedAt ? new Date(session.startedAt).getTime() : 0;
    const t1 = session.endedAt
      ? new Date(session.endedAt).getTime() + 6 * 60 * 60 * 1000
      : t0 + 6 * 60 * 60 * 1000;
    windowLogs = sorted.filter((l) => {
      if (l.payload?.sessionId === session.id) return true;
      const t = new Date(l.loggedAt).getTime();
      return t >= t0 && t <= t1 && !["re_enrolled", "stuck_recovery"].includes(l.stepName);
    });
  }

  const startAt = windowLogs[0]?.loggedAt
    ? new Date(windowLogs[0].loggedAt).getTime()
    : session.startedAt
      ? new Date(session.startedAt).getTime()
      : 0;
  const endAt = windowLogs[windowLogs.length - 1]?.loggedAt
    ? new Date(windowLogs[windowLogs.length - 1].loggedAt).getTime() + 60_000
    : session.endedAt
      ? new Date(session.endedAt).getTime() + 6 * 60 * 60 * 1000
      : Date.now();

  const windowMessages = (messages || []).filter((m) => {
    const t = new Date(m.createdAt).getTime();
    return t >= startAt - 5_000 && t <= endAt;
  });

  return { logs: windowLogs, messages: windowMessages };
}
