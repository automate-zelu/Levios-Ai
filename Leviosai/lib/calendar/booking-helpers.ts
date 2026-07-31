// ─── Pure booking / scheduling helpers (Module 10) ───────────────────────────

import type { CalendarProvider, CalendarEventInput, CalendarConnectionPublic } from "./types.js";
import { isCalendarProvider } from "./types.js";

export const DEFAULT_APPOINTMENT_DURATION_MINUTES = 30;
export const ACTIVE_CALENDAR_SETTING_KEY = "calendar.activeProvider";

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
