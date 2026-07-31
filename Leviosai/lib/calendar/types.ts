// ─── Calendar integration types (Module 10) ─────────────────────────────────

export type CalendarProvider = "google" | "outlook";

export const CALENDAR_PROVIDERS: CalendarProvider[] = ["google", "outlook"];

export function isCalendarProvider(value: unknown): value is CalendarProvider {
  return value === "google" || value === "outlook";
}

export interface CalendarEventInput {
  title: string;
  description?: string;
  start: Date;
  end: Date;
  attendeeEmail?: string | null;
  attendeeName?: string | null;
  timezone?: string;
}

export interface CalendarEventResult {
  eventId: string;
  htmlLink?: string | null;
}

export interface CalendarListItem {
  id: string;
  name: string;
  primary?: boolean;
}

export interface CalendarConnectionPublic {
  provider: CalendarProvider;
  accountEmail: string | null;
  calendarId: string;
  connectedAt: string | null;
}

export interface BookAppointmentInput {
  organizationId: number;
  leadId: number;
  title: string;
  scheduledAt: Date;
  durationMinutes?: number;
  description?: string;
  attendeeEmail?: string | null;
  attendeeName?: string | null;
  timezone?: string;
}

export interface BookAppointmentResult {
  appointmentId: number;
  calendarEventId: string | null;
  calendarProvider: CalendarProvider | null;
  synced: boolean;
  syncError?: string;
}
