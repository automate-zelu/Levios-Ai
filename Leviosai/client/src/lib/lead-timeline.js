/**
 * Build a chronological lead activity timeline (P2.3).
 * Merges messages, appointments, and activity rows — never invents demo events.
 */

export function mapMessagesToTimeline(messages = []) {
  return (messages || []).map((m) => {
    const channel = String(m.channel || "").toLowerCase();
    return {
      id: `msg-${m.id}`,
      at: m.createdAt || m.sentAt || null,
      channel: channel === "email" ? "email" : "sms",
      title: channel === "email" ? "Email" : "SMS",
      body: m.content || m.body || m.subject || "(no content)",
      direction: m.direction || "outbound",
      meta: m.status || null,
    };
  });
}

export function mapAppointmentsToTimeline(appointments = []) {
  return (appointments || []).map((a) => ({
    id: `appt-${a.id}`,
    at: a.scheduledAt || a.createdAt || null,
    channel: "appointment",
    title: a.title || "Appointment",
    body: a.status ? `Status: ${a.status}` : "Scheduled",
    direction: "system",
    meta: a.status || null,
  }));
}

export function mapActivityToTimeline(rows = []) {
  return (rows || []).map((a) => ({
    id: `act-${a.id || `${a.action}-${a.createdAt}`}`,
    at: a.createdAt || null,
    channel: "system",
    title: a.action || "Activity",
    body: a.details || a.action || "Update",
    direction: "system",
    meta: a.entityType || null,
  }));
}

export function mapCallSessionsToTimeline(sessions = []) {
  return (sessions || []).map((s) => ({
    id: `call-${s.id}`,
    at: s.startedAt || s.endedAt || s.createdAt || null,
    channel: "call",
    title: "AI Call",
    body: s.outcome || s.status || "Call completed",
    direction: "outbound",
    meta: s.durationSeconds != null ? `${s.durationSeconds}s` : null,
  }));
}

/** Merge + sort newest first. Empty inputs → []. */
export function buildLeadTimeline({
  messages = [],
  appointments = [],
  activity = [],
  callSessions = [],
} = {}) {
  const items = [
    ...mapMessagesToTimeline(messages),
    ...mapAppointmentsToTimeline(appointments),
    ...mapActivityToTimeline(activity),
    ...mapCallSessionsToTimeline(callSessions),
  ].filter((i) => i.at);

  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return items;
}

export function filterTimelineByChannel(items, channel) {
  if (!channel || channel === "all") return items;
  return items.filter((i) => i.channel === channel);
}
