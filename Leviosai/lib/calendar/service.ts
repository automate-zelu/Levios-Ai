// ─── Calendar booking service — DB appointment + optional provider sync ──────

import { sql } from "drizzle-orm";
import { db } from "../db.js";
import { storage } from "../storage.js";
import {
  ACTIVE_CALENDAR_SETTING_KEY,
  CALENDAR_BOOKING_PREFS_KEY,
  DEFAULT_CALENDAR_BOOKING_PREFS,
  normalizeCalendarBookingPrefs,
  buildCalendarEventPayload,
  defaultAppointmentTitle,
  publicConnectionStatus,
  resolveActiveProvider,
  assertScheduledAtNotInPast,
  filterFutureSlots,
  type CalendarBookingPrefs,
} from "./booking-helpers.js";
import {
  createProviderEvent,
  updateProviderEvent,
  deleteProviderEvent,
  listProviderCalendars,
  queryProviderFreeBusy,
  computeOpenSlots,
  refreshAccessToken,
} from "./providers.js";
import {
  getCalendarConnection,
  listCalendarConnections,
  updateConnectionTokens,
} from "./tokens.js";
import type {
  BookAppointmentInput,
  BookAppointmentResult,
  CalendarListItem,
  CalendarProvider,
} from "./types.js";

export interface AvailabilityQuery {
  organizationId: number;
  daysAhead?: number;
  durationMinutes?: number;
  maxSlots?: number;
  timezone?: string;
  timeMin?: Date;
  timeMax?: Date;
}

export interface AvailabilitySlotDto {
  start: string;
  end: string;
  label: string;
}

export interface AvailabilityResult {
  provider: CalendarProvider | null;
  timezone: string;
  slots: AvailabilitySlotDto[];
  connected: boolean;
  error?: string;
  prefs?: CalendarBookingPrefs;
  /** True when slots are working-hours fallback (FreeBusy failed). */
  degraded?: boolean;
}
async function readOrgSettings(organizationId: number): Promise<Record<string, any>> {
  try {
    const result: any = await db.execute(sql`
      SELECT settings FROM org_settings WHERE organization_id = ${organizationId} LIMIT 1
    `);
    const row = result.rows?.[0] || result[0];
    if (!row?.settings) return {};
    return JSON.parse(row.settings || "{}");
  } catch {
    return {};
  }
}

async function writeOrgSetting(organizationId: number, key: string, value: unknown): Promise<void> {
  const current = await readOrgSettings(organizationId);
  const merged = { ...current, [key]: value };
  const json = JSON.stringify(merged);
  await db.execute(sql`
    INSERT INTO org_settings (organization_id, settings, updated_at)
    VALUES (${organizationId}, ${json}, CURRENT_TIMESTAMP)
    ON CONFLICT (organization_id)
    DO UPDATE SET settings = ${json}, updated_at = CURRENT_TIMESTAMP
  `);
}

export async function getCalendarStatus(organizationId: number) {
  const connections = await listCalendarConnections(organizationId);
  const settings = await readOrgSettings(organizationId);
  const connectedProviders = connections.map((c) => c.provider);
  const activeProvider = resolveActiveProvider({
    activeSetting: settings[ACTIVE_CALENDAR_SETTING_KEY],
    connected: connectedProviders,
  });
  const bookingPrefs = normalizeCalendarBookingPrefs(settings[CALENDAR_BOOKING_PREFS_KEY]);

  return {
    connections: publicConnectionStatus(connections),
    activeProvider,
    bookingPrefs,
    providersConfigured: {
      google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      outlook: !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
    },
  };
}

export async function getCalendarBookingPrefs(
  organizationId: number
): Promise<CalendarBookingPrefs> {
  const settings = await readOrgSettings(organizationId);
  return normalizeCalendarBookingPrefs(settings[CALENDAR_BOOKING_PREFS_KEY]);
}

export async function setCalendarBookingPrefs(
  organizationId: number,
  prefs: Partial<CalendarBookingPrefs>
): Promise<CalendarBookingPrefs> {
  const next = normalizeCalendarBookingPrefs({
    ...DEFAULT_CALENDAR_BOOKING_PREFS,
    ...(await getCalendarBookingPrefs(organizationId)),
    ...prefs,
  });
  await writeOrgSetting(organizationId, CALENDAR_BOOKING_PREFS_KEY, next);
  return next;
}

export async function setActiveCalendarProvider(
  organizationId: number,
  provider: CalendarProvider | null
): Promise<CalendarProvider | null> {
  if (provider) {
    const conn = await getCalendarConnection(organizationId, provider);
    if (!conn) throw new Error(`${provider} calendar is not connected`);
  }
  await writeOrgSetting(organizationId, ACTIVE_CALENDAR_SETTING_KEY, provider);
  return provider;
}

async function getValidAccessToken(
  organizationId: number,
  provider: CalendarProvider
): Promise<{ accessToken: string; calendarId: string } | null> {
  const conn = await getCalendarConnection(organizationId, provider);
  if (!conn) return null;

  const expiresSoon =
    conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() < Date.now() + 60_000;

  if (!expiresSoon) {
    return { accessToken: conn.accessToken, calendarId: conn.calendarId };
  }

  if (!conn.refreshToken) {
    return { accessToken: conn.accessToken, calendarId: conn.calendarId };
  }

  const refreshed = await refreshAccessToken(provider, conn.refreshToken);
  await updateConnectionTokens(organizationId, provider, {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    tokenExpiresAt: refreshed.expiresAt,
  });
  return { accessToken: refreshed.accessToken, calendarId: conn.calendarId };
}

export async function listCalendarsForOrg(
  organizationId: number,
  provider?: CalendarProvider | null
): Promise<{ provider: CalendarProvider; calendars: CalendarListItem[] }> {
  const status = await getCalendarStatus(organizationId);
  const useProvider = provider || status.activeProvider;
  if (!useProvider) throw new Error("No calendar connected");

  const tokens = await getValidAccessToken(organizationId, useProvider);
  if (!tokens) throw new Error(`${useProvider} calendar is not connected`);

  const calendars = await listProviderCalendars(useProvider, tokens.accessToken);
  return { provider: useProvider, calendars };
}

function formatSlotLabel(start: Date, end: Date, timeZone: string): string {
  try {
    const opts: Intl.DateTimeFormatOptions = {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    };
    const a = new Intl.DateTimeFormat("en-US", opts).format(start);
    const b = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    }).format(end);
    return `${a} – ${b}`;
  } catch {
    return `${start.toISOString()} – ${end.toISOString()}`;
  }
}

/** Working-hours slots with no FreeBusy (used when Google Calendar API is down). */
export function workingHoursFallbackSlots(
  prefs: CalendarBookingPrefs,
  now = new Date()
): AvailabilitySlotDto[] {
  const timezone = prefs.timezone || "America/New_York";
  const timeMin = new Date(now.getTime() + 60 * 60_000);
  const timeMax = new Date(timeMin.getTime() + prefs.daysAhead * 24 * 60 * 60_000);
  const open = computeOpenSlots({
    timeMin,
    timeMax,
    busy: [],
    durationMinutes: prefs.durationMinutes,
    maxSlots: prefs.maxSlots,
    timezone,
    dayStartHour: prefs.dayStartHour,
    dayEndHour: prefs.dayEndHour,
  });
  return filterFutureSlots(
    open.map((s) => ({
      start: s.start.toISOString(),
      end: s.end.toISOString(),
      label: formatSlotLabel(s.start, s.end, timezone),
    })),
    now
  );
}

/** Make Google Cloud “API not enabled” errors actionable for agents + UI. */
export function humanizeCalendarApiError(raw: string | null | undefined): string {
  const msg = String(raw || "").trim();
  if (!msg) return "Availability check failed";
  if (/has not been used|is disabled|Enable it by visiting/i.test(msg)) {
    return (
      "Google Calendar API is disabled for this Google Cloud project. " +
      "Enable “Google Calendar API” at https://console.cloud.google.com/apis/library/calendar-json.googleapis.com " +
      "then wait a few minutes and retry."
    );
  }
  if (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions/i.test(msg)) {
    return "Calendar permission is insufficient. Reconnect Google Calendar with calendar access enabled.";
  }
  return msg;
}

/**
 * Return open appointment slots from the org's active calendar (Google FreeBusy).
 */
export async function getCalendarAvailability(
  query: AvailabilityQuery
): Promise<AvailabilityResult> {
  const prefs = await getCalendarBookingPrefs(query.organizationId);
  const timezone = query.timezone || prefs.timezone || "America/New_York";
  const status = await getCalendarStatus(query.organizationId);
  const provider = status.activeProvider;

  if (!provider) {
    return {
      provider: null,
      timezone,
      slots: [],
      connected: false,
      error: "No calendar connected",
    };
  }

  const daysAhead = Math.min(21, Math.max(1, query.daysAhead ?? prefs.daysAhead));
  const durationMinutes = query.durationMinutes ?? prefs.durationMinutes;
  const timeMin = query.timeMin || new Date(Date.now() + 60 * 60_000);
  const timeMax =
    query.timeMax || new Date(timeMin.getTime() + daysAhead * 24 * 60 * 60_000);

  // Mock mode: exercise agent booking decisions without live Google/Outlook.
  if (process.env.AGENT_CALENDAR_MOCK === "1") {
    const mockSlots = workingHoursFallbackSlots({
      ...prefs,
      durationMinutes,
      daysAhead,
      maxSlots: query.maxSlots ?? prefs.maxSlots,
    });
    return {
      provider,
      timezone,
      connected: true,
      slots: mockSlots,
      prefs,
    };
  }

  try {
    const tokens = await getValidAccessToken(query.organizationId, provider);
    if (!tokens) {
      return {
        provider,
        timezone,
        slots: [],
        connected: false,
        error: `${provider} calendar is not connected`,
      };
    }

    const busy = await queryProviderFreeBusy(
      provider,
      tokens.accessToken,
      tokens.calendarId,
      timeMin,
      timeMax
    );
    const open = computeOpenSlots({
      timeMin,
      timeMax,
      busy,
      durationMinutes,
      maxSlots: query.maxSlots ?? prefs.maxSlots,
      timezone,
      dayStartHour: prefs.dayStartHour,
      dayEndHour: prefs.dayEndHour,
    });

    return {
      provider,
      timezone,
      connected: true,
      slots: filterFutureSlots(
        open.map((s) => ({
          start: s.start.toISOString(),
          end: s.end.toISOString(),
          label: formatSlotLabel(s.start, s.end, timezone),
        }))
      ),
      prefs,
    };
  } catch (err: any) {
    const fallback = workingHoursFallbackSlots(prefs);
    return {
      provider,
      timezone,
      connected: true,
      slots: fallback,
      error: humanizeCalendarApiError(err?.message || "Availability check failed"),
      prefs,
      degraded: true,
    };
  }
}

export async function bookAppointmentWithCalendar(
  input: BookAppointmentInput
): Promise<BookAppointmentResult> {
  // Hard rule: never persist or sync appointments in the past (LLM year slips, etc.)
  assertScheduledAtNotInPast(input.scheduledAt);

  const { ensureAppointmentCalendarColumns } = await import("./schema-ensure.js");
  await ensureAppointmentCalendarColumns();

  const lead = await storage.getLead(input.leadId);
  const leadName = lead
    ? [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim()
    : null;

  const title = defaultAppointmentTitle({
    title: input.title,
    leadName: input.attendeeName || leadName,
  });

  const appt = await storage.createAppointment({
    leadId: input.leadId,
    title,
    scheduledAt: input.scheduledAt,
    status: "scheduled",
  });

  // Bill Levios client for this booking when their per-appointment fee is enabled.
  try {
    const { recordBookingAppointmentCharge } = await import("../commercial-pricing-service.js");
    await recordBookingAppointmentCharge({
      organizationId: input.organizationId,
      appointmentId: appt.id,
      leadId: input.leadId,
      source: "voice_or_calendar_book",
    });
  } catch (err: any) {
    console.error("appointment charge failed:", err?.message || err);
  }

  const attendeeEmail = input.attendeeEmail ?? lead?.email;
  if (attendeeEmail) {
    void (async () => {
      const { formatBookingWhen } = await import("../booking-lifecycle.js");
      const { bookingEmail } = await import("../email-templates.js");
      const { sendEmailViaGmail } = await import("../gmail/send.js");
      const { storage: st } = await import("../storage.js");
      const org = await st.getOrganization(input.organizationId);
      const when = formatBookingWhen(input.scheduledAt, input.timezone);
      const mail = bookingEmail({
        kind: "confirmed",
        firstName: input.attendeeName || lead?.firstName,
        title,
        whenLabel: when,
        companyName: org?.name,
      });
      await sendEmailViaGmail(
        input.organizationId,
        attendeeEmail,
        mail.subject,
        mail.text,
        mail.html
      );
    })().catch((err: Error) => console.error("Booking confirmation email failed:", err.message));
  }

  const status = await getCalendarStatus(input.organizationId);
  const provider = status.activeProvider;

  if (process.env.AGENT_CALENDAR_MOCK === "1") {
    return {
      appointmentId: appt.id,
      calendarEventId: `mock_evt_${appt.id}`,
      calendarProvider: provider,
      synced: true,
    };
  }

  if (!provider) {
    return {
      appointmentId: appt.id,
      calendarEventId: null,
      calendarProvider: null,
      synced: false,
    };
  }

  try {
    const tokens = await getValidAccessToken(input.organizationId, provider);
    if (!tokens) {
      return {
        appointmentId: appt.id,
        calendarEventId: null,
        calendarProvider: provider,
        synced: false,
        syncError: "Calendar not connected",
      };
    }

    const event = buildCalendarEventPayload({
      title,
      description: input.description,
      scheduledAt: input.scheduledAt,
      durationMinutes: input.durationMinutes,
      attendeeEmail: input.attendeeEmail ?? lead?.email,
      attendeeName: input.attendeeName || leadName,
      timezone: input.timezone,
    });

    const created = await createProviderEvent(
      provider,
      tokens.accessToken,
      tokens.calendarId,
      event
    );

    await storage.updateAppointment(appt.id, {
      calendarEventId: created.eventId,
      calendarProvider: provider,
    } as any);

    return {
      appointmentId: appt.id,
      calendarEventId: created.eventId,
      calendarProvider: provider,
      synced: true,
    };
  } catch (err: any) {
    return {
      appointmentId: appt.id,
      calendarEventId: null,
      calendarProvider: provider,
      synced: false,
      syncError: humanizeCalendarApiError(err?.message || "Calendar sync failed"),
    };
  }
}

export type BookingLifecycleAction = "cancel" | "reschedule" | "delete";

export interface MutateAppointmentInput {
  organizationId: number;
  appointmentId: number;
  action: BookingLifecycleAction;
  scheduledAt?: Date;
  notify?: boolean;
  durationMinutes?: number;
  timezone?: string;
}

export interface MutateAppointmentResult {
  appointment: Record<string, unknown> | null;
  calendarSynced: boolean;
  syncError?: string;
  notified: { sms: boolean; email: boolean };
  notifyErrors: { sms?: string; email?: string };
  action: BookingLifecycleAction;
}

async function syncCalendarForMutation(opts: {
  organizationId: number;
  action: BookingLifecycleAction;
  calendarEventId: string | null;
  calendarProvider: string | null;
  title: string;
  scheduledAt: Date;
  durationMinutes?: number;
  timezone?: string;
  attendeeEmail?: string | null;
  attendeeName?: string | null;
}): Promise<{ synced: boolean; error?: string; eventId?: string | null }> {
  const { isCalendarProvider } = await import("./types.js");
  const provider = opts.calendarProvider;
  if (!opts.calendarEventId || !isCalendarProvider(provider)) {
    return { synced: false };
  }
  try {
    const tokens = await getValidAccessToken(opts.organizationId, provider);
    if (!tokens) return { synced: false, error: "Calendar not connected" };

    if (opts.action === "reschedule") {
      const event = buildCalendarEventPayload({
        title: opts.title,
        scheduledAt: opts.scheduledAt,
        durationMinutes: opts.durationMinutes,
        attendeeEmail: opts.attendeeEmail,
        attendeeName: opts.attendeeName,
        timezone: opts.timezone,
      });
      await updateProviderEvent(provider, tokens.accessToken, tokens.calendarId, opts.calendarEventId, event);
      return { synced: true, eventId: opts.calendarEventId };
    }

    await deleteProviderEvent(provider, tokens.accessToken, tokens.calendarId, opts.calendarEventId);
    return { synced: true, eventId: null };
  } catch (err: any) {
    return { synced: false, error: humanizeCalendarApiError(err?.message || "Calendar sync failed") };
  }
}

export async function mutateAppointmentWithCalendar(
  input: MutateAppointmentInput
): Promise<MutateAppointmentResult> {
  const {
    canPerformBookingAction,
    planBookingMutation,
    composeBookingNotice,
    formatBookingWhen,
  } = await import("../booking-lifecycle.js");
  const { notifyLeadBookingChange } = await import("../booking-notify-send.js");

  const row = await storage.getAppointment(input.appointmentId, input.organizationId);
  if (!row) {
    throw Object.assign(new Error("Appointment not found"), { status: 404 });
  }

  const allowed = canPerformBookingAction(row.status, input.action);
  if (!allowed.ok) {
    throw Object.assign(new Error(allowed.reason || "Action not allowed"), { status: 400 });
  }

  if (input.action === "reschedule" && !input.scheduledAt) {
    throw Object.assign(new Error("scheduledAt is required to reschedule"), { status: 400 });
  }
  if (input.action === "reschedule" && input.scheduledAt) {
    assertScheduledAtNotInPast(input.scheduledAt);
  }

  const plan = planBookingMutation(input.action);
  const prefs = await getCalendarBookingPrefs(input.organizationId);
  const timezone = input.timezone || prefs.timezone || "America/New_York";
  const nextTime = input.action === "reschedule" ? input.scheduledAt! : new Date(row.scheduledAt);
  const leadName = [row.leadFirstName, row.leadLastName].filter(Boolean).join(" ").trim();

  const cal = await syncCalendarForMutation({
    organizationId: input.organizationId,
    action: input.action,
    calendarEventId: row.calendarEventId,
    calendarProvider: row.calendarProvider,
    title: row.title,
    scheduledAt: nextTime,
    durationMinutes: input.durationMinutes || prefs.durationMinutes,
    timezone,
    attendeeEmail: row.leadEmail,
    attendeeName: leadName || null,
  });

  if (plan.deleteRow) {
    await storage.deleteAppointment(row.id);
  } else {
    const patch: Record<string, unknown> = { status: plan.nextStatus };
    if (input.action === "reschedule") {
      patch.scheduledAt = nextTime;
    }
    if (plan.calendar === "delete") {
      patch.calendarEventId = null;
    }
    await storage.updateAppointment(row.id, patch as any);
  }

  const previousWhen = formatBookingWhen(new Date(row.scheduledAt), timezone);
  const nextWhen = formatBookingWhen(nextTime, timezone);
  const notice = composeBookingNotice({
    action: input.action,
    leadFirstName: row.leadFirstName,
    title: row.title,
    previousWhen,
    nextWhen,
    companyName: row.orgName,
  });

  let notified = { sms: false, email: false };
  let notifyErrors: { sms?: string; email?: string } = {};
  if (input.notify !== false) {
    const sent = await notifyLeadBookingChange({
      organizationId: input.organizationId,
      leadId: row.leadId,
      phone: row.leadPhone,
      email: row.leadEmail,
      sms: notice.sms,
      emailSubject: notice.emailSubject,
      emailBody: notice.emailBody,
    });
    notified = { sms: sent.sms, email: sent.email };
    notifyErrors = sent.errors;
  }

  const appointment = plan.deleteRow
    ? null
    : await storage.getAppointment(row.id, input.organizationId);

  await storage.logActivity({
    entityType: "appointment",
    entityId: row.id,
    action: input.action === "delete" ? "deleted" : input.action === "cancel" ? "cancelled" : "rescheduled",
    details:
      input.action === "reschedule"
        ? `Rescheduled from ${previousWhen} to ${nextWhen}`
        : `${input.action} — ${previousWhen}`,
    organizationId: input.organizationId,
  });

  return {
    appointment: appointment as any,
    calendarSynced: cal.synced,
    syncError: cal.error,
    notified,
    notifyErrors,
    action: input.action,
  };
}
