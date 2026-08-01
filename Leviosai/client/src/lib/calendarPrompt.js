// Shared calendar prompt helpers for the client (mirrors lib/calendar/prompt-block.ts).

export const CALENDAR_PROMPT_MARKER = "## Calendar tools (Levios)";

export const DEFAULT_BOOKING_PREFS = {
  daysAhead: 5,
  durationMinutes: 30,
  dayStartHour: 9,
  dayEndHour: 17,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
  maxSlots: 8,
  offerCount: 3,
};

export const CALENDAR_TOOL_CHIPS = [
  {
    id: "check_availability",
    label: "Check availability",
    hint: "When to call check_availability",
    snippet:
      "When scheduling comes up, call the check_availability tool before offering any times. Never invent open slots.",
  },
  {
    id: "book_appointment",
    label: "Book appointment",
    hint: "When to call book_appointment",
    snippet:
      "Only call book_appointment after the lead clearly confirms one of the offered slots. Then confirm the time verbally.",
  },
  {
    id: "full_block",
    label: "Full calendar tools block",
    hint: "Insert/replace the full ## Calendar tools section",
    snippet: null,
  },
];

export function buildCalendarPromptBlock({
  accountEmail,
  provider = "google",
  timezone,
  prefs,
} = {}) {
  const p = { ...DEFAULT_BOOKING_PREFS, ...(prefs || {}) };
  const tz = timezone || p.timezone || "America/New_York";
  const email = accountEmail ? ` · ${accountEmail}` : "";

  return `${CALENDAR_PROMPT_MARKER}
You have live tools: check_availability and book_appointment.
When the lead wants to schedule a meeting:
1. Call check_availability (it already uses your configured window: next ${p.daysAhead} days, ${p.durationMinutes}-minute meetings, business hours ${p.dayStartHour}:00–${p.dayEndHour}:00 ${tz}).
2. Offer up to ${p.offerCount} real open slots in plain language (never invent availability).
3. Call book_appointment only after they clearly confirm one slot.
4. Confirm the booking verbally once the tool succeeds.
Do not ask the lead to invent times first — check the calendar tool first, then offer slots.
Timezone: ${tz}
Active calendar: ${provider}${email}
Meeting length: ${p.durationMinutes} minutes
Search window: ${p.daysAhead} days ahead
`;
}

export function hasCalendarPromptBlock(systemPrompt) {
  return String(systemPrompt || "").includes(CALENDAR_PROMPT_MARKER);
}

export function injectCalendarPromptBlock(systemPrompt, ctx = {}) {
  const block = buildCalendarPromptBlock(ctx).trim();
  const existing = String(systemPrompt || "").trim();
  if (!existing) return block;

  const markerIdx = existing.indexOf(CALENDAR_PROMPT_MARKER);
  if (markerIdx < 0) {
    return `${existing}\n\n${block}`;
  }

  const after = existing.slice(markerIdx + CALENDAR_PROMPT_MARKER.length);
  const nextHeading = after.search(/\n## /);
  const end = nextHeading >= 0 ? markerIdx + CALENDAR_PROMPT_MARKER.length + nextHeading : existing.length;
  const before = existing.slice(0, markerIdx).trimEnd();
  const rest = existing.slice(end).trimStart();
  return [before, block, rest].filter(Boolean).join("\n\n");
}

/** Append a short tool instruction line (chip) without duplicating if already present. */
export function appendToolSnippet(systemPrompt, snippet) {
  const existing = String(systemPrompt || "").trim();
  if (!snippet) return existing;
  if (existing.includes(snippet.trim())) return existing;
  return existing ? `${existing}\n\n${snippet.trim()}` : snippet.trim();
}
