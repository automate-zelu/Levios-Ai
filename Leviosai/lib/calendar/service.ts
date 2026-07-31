// ─── Calendar booking service — DB appointment + optional provider sync ──────

import { sql } from "drizzle-orm";
import { db } from "../db.js";
import { storage } from "../storage.js";
import {
  ACTIVE_CALENDAR_SETTING_KEY,
  buildCalendarEventPayload,
  defaultAppointmentTitle,
  publicConnectionStatus,
  resolveActiveProvider,
} from "./booking-helpers.js";
import {
  createProviderEvent,
  listProviderCalendars,
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

  return {
    connections: publicConnectionStatus(connections),
    activeProvider,
    providersConfigured: {
      google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      outlook: !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
    },
  };
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

export async function bookAppointmentWithCalendar(
  input: BookAppointmentInput
): Promise<BookAppointmentResult> {
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

  const status = await getCalendarStatus(input.organizationId);
  const provider = status.activeProvider;

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
      syncError: err?.message || "Calendar sync failed",
    };
  }
}
