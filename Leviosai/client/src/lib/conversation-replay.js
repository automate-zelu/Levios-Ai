/**
 * Helpers for Conversation Replay — map API rows to UI items (no demo/seed data).
 */

export function formatReplayDate(value) {
  if (!value) return "—";
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}

export function formatCallDuration(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Normalize call session list rows into replay cards. */
export function mapCallSessionsToReplay(sessions = []) {
  return (sessions || []).map((s) => {
    const leadName =
      s.leadName ||
      [s.leadFirstName, s.leadLastName].filter(Boolean).join(" ").trim() ||
      s.leadPhone ||
      "Unknown lead";
    let transcript = [];
    if (typeof s.transcript === "string" && s.transcript.trim()) {
      try {
        const parsed = JSON.parse(s.transcript);
        if (Array.isArray(parsed)) {
          transcript = parsed.map((line) => ({
            role: line.speaker === "lead" || line.role === "lead" ? "lead" : "agent",
            text: line.text || line.content || "",
          }));
        } else {
          transcript = [{ role: "agent", text: s.transcript }];
        }
      } catch {
        transcript = [{ role: "agent", text: s.transcript }];
      }
    } else if (Array.isArray(s.transcript)) {
      transcript = s.transcript.map((line) => ({
        role: line.speaker === "lead" || line.role === "lead" ? "lead" : "agent",
        text: line.text || line.content || "",
      }));
    }

    return {
      id: `voice-${s.id}`,
      type: "voice",
      date: formatReplayDate(s.startedAt || s.endedAt),
      agent: "AI Agent",
      duration: formatCallDuration(s.durationSeconds),
      outcome: s.outcome || s.status || "completed",
      sentiment: "neutral",
      leadName,
      leadId: s.leadId || null,
      transcript,
      source: "call",
    };
  });
}

/** Normalize recent message rows into replay cards. */
export function mapMessagesToReplay(messages = []) {
  return (messages || []).map((m) => {
    const channel = String(m.channel || "").toLowerCase();
    const type = channel === "email" ? "email" : "sms";
    const leadName =
      [m.leadFirstName, m.leadLastName].filter(Boolean).join(" ").trim() ||
      m.leadEmail ||
      m.leadPhone ||
      "Unknown lead";
    return {
      id: `${type}-${m.id}`,
      type,
      date: formatReplayDate(m.createdAt || m.sentAt),
      agent: m.aiGenerated ? "AI Agent" : "Human",
      duration: null,
      outcome: m.direction === "inbound" ? "replied" : m.status || "sent",
      sentiment: "neutral",
      leadName,
      leadId: m.leadId || null,
      transcript: [
        {
          role: m.direction === "inbound" ? "lead" : "agent",
          text: m.content || m.body || m.subject || "(no content)",
        },
      ],
      source: "message",
    };
  });
}

export function mapActivityToFeed(rows = []) {
  return (rows || []).map((a) => ({
    time: formatReplayDate(a.createdAt),
    action: a.details || a.action || "Activity",
    lead: a.entityType === "lead" ? `Lead #${a.entityId}` : a.entityType || "System",
    result: /fail|error|declin/i.test(String(a.action || a.details || ""))
      ? "declined"
      : /credit/i.test(String(a.action || a.details || ""))
        ? "credit"
        : "success",
  }));
}
