// Shared calendar prompt helpers for the client (mirrors lib/calendar/prompt-block.ts).

export const CALENDAR_PROMPT_MARKER = "## Calendar tools (Levios)";

export function buildCalendarPromptBlock({
  accountEmail,
  provider = "google",
  timezone,
} = {}) {
  const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  const email = accountEmail ? ` · ${accountEmail}` : "";

  return `${CALENDAR_PROMPT_MARKER}
You have live tools: check_availability and book_appointment.
When the lead wants to schedule a meeting:
1. Call check_availability for the next few business days.
2. Offer 2–3 real open slots in plain language (never invent availability).
3. Call book_appointment only after they clearly confirm one slot.
4. Confirm the booking verbally once the tool succeeds.
Timezone: ${tz}
Active calendar: ${provider}${email}
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
