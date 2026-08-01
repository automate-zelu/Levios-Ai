// ─── Calendar tool prompt block for SDR system prompt (Vapi-style) ───────────

export const CALENDAR_PROMPT_MARKER = "## Calendar tools (Levios)";

export interface CalendarPromptContext {
  accountEmail?: string | null;
  provider?: string | null;
  timezone?: string;
}

/** Build the delimited calendar tools block for the voice agent prompt. */
export function buildCalendarPromptBlock(ctx: CalendarPromptContext = {}): string {
  const tz = ctx.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  const provider = ctx.provider || "google";
  const email = ctx.accountEmail ? ` · ${ctx.accountEmail}` : "";

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

/** True if systemPrompt already contains the Levios calendar tools block. */
export function hasCalendarPromptBlock(systemPrompt: string | null | undefined): boolean {
  return String(systemPrompt || "").includes(CALENDAR_PROMPT_MARKER);
}

/**
 * Idempotently inject (or replace) the calendar tools block into a system prompt.
 */
export function injectCalendarPromptBlock(
  systemPrompt: string | null | undefined,
  ctx: CalendarPromptContext = {}
): string {
  const block = buildCalendarPromptBlock(ctx).trim();
  const existing = String(systemPrompt || "").trim();
  if (!existing) return block;

  const markerIdx = existing.indexOf(CALENDAR_PROMPT_MARKER);
  if (markerIdx < 0) {
    return `${existing}\n\n${block}`;
  }

  // Replace from marker through end-of-block (until next ## heading or EOF)
  const after = existing.slice(markerIdx + CALENDAR_PROMPT_MARKER.length);
  const nextHeading = after.search(/\n## /);
  const end = nextHeading >= 0 ? markerIdx + CALENDAR_PROMPT_MARKER.length + nextHeading : existing.length;
  const before = existing.slice(0, markerIdx).trimEnd();
  const rest = existing.slice(end).trimStart();
  return [before, block, rest].filter(Boolean).join("\n\n");
}
