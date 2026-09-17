// ─── Calendar tool prompt block for SDR system prompt (Vapi-style) ───────────

import type { CalendarBookingPrefs } from "./booking-helpers.js";
import { DEFAULT_CALENDAR_BOOKING_PREFS } from "./booking-helpers.js";

export const CALENDAR_PROMPT_MARKER = "## Calendar tools (Levios)";

export interface CalendarPromptContext {
  accountEmail?: string | null;
  provider?: string | null;
  timezone?: string;
  prefs?: Partial<CalendarBookingPrefs> | null;
}

function mergePrefs(partial?: Partial<CalendarBookingPrefs> | null): CalendarBookingPrefs {
  return { ...DEFAULT_CALENDAR_BOOKING_PREFS, ...(partial || {}) };
}

/** Build the delimited calendar tools block for the voice agent prompt. */
export function buildCalendarPromptBlock(ctx: CalendarPromptContext = {}): string {
  const prefs = mergePrefs(ctx.prefs);
  const tz = ctx.timezone || prefs.timezone || "America/New_York";
  const provider = ctx.provider || "google";
  const email = ctx.accountEmail ? ` · ${ctx.accountEmail}` : "";

  return `${CALENDAR_PROMPT_MARKER}
You have live tools: check_availability and book_appointment.
When the lead wants to schedule a meeting:
1. Call check_availability (it already uses your configured window: next ${prefs.daysAhead} days, ${prefs.durationMinutes}-minute meetings, business hours ${prefs.dayStartHour}:00–${prefs.dayEndHour}:00 ${tz}).
2. Offer up to ${prefs.offerCount} real open slots in plain language (never invent availability).
3. Call book_appointment only after they clearly confirm one slot — pass scheduledAt as the exact ISO string from slots[].start (never invent a year or past date).
4. Confirm the booking verbally once the tool succeeds.
Do not ask the lead to invent times first — check the calendar tool first, then offer slots.
The backend rejects any booking time in the past; only current/future slots are valid.
Timezone: ${tz}
Active calendar: ${provider}${email}
Meeting length: ${prefs.durationMinutes} minutes
Search window: ${prefs.daysAhead} days ahead
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

  const after = existing.slice(markerIdx + CALENDAR_PROMPT_MARKER.length);
  const nextHeading = after.search(/\n## /);
  const end = nextHeading >= 0 ? markerIdx + CALENDAR_PROMPT_MARKER.length + nextHeading : existing.length;
  const before = existing.slice(0, markerIdx).trimEnd();
  const rest = existing.slice(end).trimStart();
  return [before, block, rest].filter(Boolean).join("\n\n");
}

/** Tool chip snippets for the SDR Agent UI (insert into prompt). */
export const CALENDAR_TOOL_CHIPS = [
  {
    id: "check_availability",
    label: "Check availability",
    hint: "Tell the agent when to call check_availability",
    snippet:
      "When scheduling comes up, call the check_availability tool before offering any times. Never invent open slots.",
  },
  {
    id: "book_appointment",
    label: "Book appointment",
    hint: "Tell the agent when to call book_appointment",
    snippet:
      "Only call book_appointment after the lead clearly confirms one of the offered slots. Then confirm the time verbally.",
  },
  {
    id: "full_block",
    label: "Full calendar tools block",
    hint: "Replace/insert the full ## Calendar tools section",
    snippet: null as string | null,
  },
] as const;
