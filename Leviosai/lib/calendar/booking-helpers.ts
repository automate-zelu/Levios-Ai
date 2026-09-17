// ─── Pure booking / scheduling helpers (Module 10) ───────────────────────────

import type { CalendarProvider, CalendarEventInput, CalendarConnectionPublic } from "./types.js";
import { isCalendarProvider } from "./types.js";

export const DEFAULT_APPOINTMENT_DURATION_MINUTES = 30;
export const ACTIVE_CALENDAR_SETTING_KEY = "calendar.activeProvider";
/** Org-level prefs for SDR voice agent availability / booking tools */
export const CALENDAR_BOOKING_PREFS_KEY = "calendar.bookingPrefs";

export interface CalendarBookingPrefs {
  daysAhead: number;
  durationMinutes: number;
  dayStartHour: number;
  dayEndHour: number;
  timezone: string;
  maxSlots: number;
  /** How many slots the agent should verbally offer */
  offerCount: number;
}

export const DEFAULT_CALENDAR_BOOKING_PREFS: CalendarBookingPrefs = {
  daysAhead: 5,
  durationMinutes: 30,
  dayStartHour: 9,
  dayEndHour: 17,
  timezone: "America/New_York",
  maxSlots: 8,
  offerCount: 3,
};

export function normalizeCalendarBookingPrefs(raw: unknown): CalendarBookingPrefs {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };
  return {
    daysAhead: num(src.daysAhead, DEFAULT_CALENDAR_BOOKING_PREFS.daysAhead, 1, 21),
    durationMinutes: num(src.durationMinutes, DEFAULT_CALENDAR_BOOKING_PREFS.durationMinutes, 15, 120),
    dayStartHour: num(src.dayStartHour, DEFAULT_CALENDAR_BOOKING_PREFS.dayStartHour, 0, 23),
    dayEndHour: num(src.dayEndHour, DEFAULT_CALENDAR_BOOKING_PREFS.dayEndHour, 1, 24),
    timezone:
      typeof src.timezone === "string" && src.timezone.trim()
        ? src.timezone.trim()
        : DEFAULT_CALENDAR_BOOKING_PREFS.timezone,
    maxSlots: num(src.maxSlots, DEFAULT_CALENDAR_BOOKING_PREFS.maxSlots, 3, 20),
    offerCount: num(src.offerCount, DEFAULT_CALENDAR_BOOKING_PREFS.offerCount, 1, 5),
  };
}

/** Pick which connected provider to use for sync. */
export function resolveActiveProvider(opts: {
  activeSetting: unknown;
  connected: CalendarProvider[];
}): CalendarProvider | null {
  const connected = opts.connected.filter(isCalendarProvider);
  if (connected.length === 0) return null;

  if (isCalendarProvider(opts.activeSetting) && connected.includes(opts.activeSetting)) {
    return opts.activeSetting;
  }

  // Prefer explicit single connection; otherwise first connected.
  if (connected.length === 1) return connected[0];
  return connected[0];
}

export function parseScheduledAt(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Hard backend rule: bookings may only start at "now" or in the future.
 * Small grace window absorbs clock skew between agent and server.
 */
export const SCHEDULED_AT_PAST_GRACE_MS = 60_000;

export function isScheduledAtInFuture(
  scheduledAt: Date,
  now: Date = new Date(),
  graceMs: number = SCHEDULED_AT_PAST_GRACE_MS
): boolean {
  if (!(scheduledAt instanceof Date) || Number.isNaN(scheduledAt.getTime())) return false;
  return scheduledAt.getTime() >= now.getTime() - Math.max(0, graceMs);
}

/** Throws a 400-style error when scheduledAt is in the past. */
export function assertScheduledAtNotInPast(
  scheduledAt: Date,
  now: Date = new Date(),
  graceMs: number = SCHEDULED_AT_PAST_GRACE_MS
): void {
  if (isScheduledAtInFuture(scheduledAt, now, graceMs)) return;
  const err = new Error(
    `Appointment time must be now or in the future (got ${scheduledAt.toISOString()}). ` +
      "Use an exact ISO start from check_availability — never invent past dates."
  );
  (err as any).status = 400;
  (err as any).code = "SCHEDULED_AT_IN_PAST";
  throw err;
}

/** Drop any open slots whose start is already in the past. */
export function filterFutureSlots<T extends { start: string | Date }>(
  slots: T[],
  now: Date = new Date(),
  graceMs: number = SCHEDULED_AT_PAST_GRACE_MS
): T[] {
  return slots.filter((s) => {
    const start = s.start instanceof Date ? s.start : new Date(s.start);
    return isScheduledAtInFuture(start, now, graceMs);
  });
}

export function appointmentEndAt(start: Date, durationMinutes = DEFAULT_APPOINTMENT_DURATION_MINUTES): Date {
  const mins = Number.isFinite(durationMinutes) && durationMinutes > 0
    ? durationMinutes
    : DEFAULT_APPOINTMENT_DURATION_MINUTES;
  return new Date(start.getTime() + mins * 60_000);
}

export function defaultAppointmentTitle(opts: {
  leadName?: string | null;
  title?: string | null;
}): string {
  const custom = opts.title?.trim();
  if (custom) return custom;
  const name = opts.leadName?.trim();
  if (name) return `Consultation — ${name}`;
  return "Consultation appointment";
}

export function buildCalendarEventPayload(input: {
  title: string;
  description?: string;
  scheduledAt: Date;
  durationMinutes?: number;
  attendeeEmail?: string | null;
  attendeeName?: string | null;
  timezone?: string;
}): CalendarEventInput {
  const start = input.scheduledAt;
  return {
    title: input.title,
    description: input.description,
    start,
    end: appointmentEndAt(start, input.durationMinutes),
    attendeeEmail: input.attendeeEmail ?? null,
    attendeeName: input.attendeeName ?? null,
    timezone: input.timezone || "UTC",
  };
}

/** Whether a call outcome should create a CRM appointment row. */
export function shouldCreateAppointmentFromOutcome(outcome: string | null | undefined): boolean {
  return outcome === "booked";
}

export function publicConnectionStatus(rows: Array<{
  provider: string;
  accountEmail: string | null;
  calendarId: string | null;
  connectedAt: Date | string | null;
}>): CalendarConnectionPublic[] {
  return rows
    .filter((r) => isCalendarProvider(r.provider))
    .map((r) => ({
      provider: r.provider as CalendarProvider,
      accountEmail: r.accountEmail,
      calendarId: r.calendarId || "primary",
      connectedAt: r.connectedAt
        ? (r.connectedAt instanceof Date ? r.connectedAt.toISOString() : String(r.connectedAt))
        : null,
    }));
}

export function canSelectActiveProvider(
  provider: CalendarProvider | null,
  connected: CalendarProvider[]
): boolean {
  if (provider === null) return true;
  return connected.includes(provider);
}
