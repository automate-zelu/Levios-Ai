// ─── Google Calendar + Microsoft Graph API clients ───────────────────────────

import {
  GOOGLE_CALENDAR_API,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  getProviderClientCredentials,
  microsoftAuthBase,
  microsoftGraphBase,
  oauthCallbackUrl,
} from "./oauth-config.js";
import type {
  CalendarEventInput,
  CalendarEventResult,
  CalendarListItem,
  CalendarProvider,
} from "./types.js";

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  accountEmail: string | null;
}

function toRfc3339(date: Date, timeZone?: string): { dateTime: string; timeZone: string } {
  return {
    dateTime: date.toISOString().replace(/\.\d{3}Z$/, "Z"),
    timeZone: timeZone || "UTC",
  };
}

export async function exchangeAuthorizationCode(
  provider: CalendarProvider,
  code: string
): Promise<OAuthTokenSet> {
  const { clientId, clientSecret, configured } = getProviderClientCredentials(provider);
  if (!configured || !clientId || !clientSecret) {
    throw new Error(`${provider} OAuth is not configured`);
  }

  const redirectUri = oauthCallbackUrl(provider);
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const tokenUrl = provider === "google"
    ? GOOGLE_TOKEN_URL
    : `${microsoftAuthBase()}/token`;

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `Token exchange failed (${res.status})`);
  }

  const accessToken = data.access_token as string;
  const refreshToken = (data.refresh_token as string) || null;
  const expiresIn = Number(data.expires_in || 3600);
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  const accountEmail = await fetchAccountEmail(provider, accessToken);

  return { accessToken, refreshToken, expiresAt, accountEmail };
}

export async function refreshAccessToken(
  provider: CalendarProvider,
  refreshToken: string
): Promise<OAuthTokenSet> {
  const { clientId, clientSecret, configured } = getProviderClientCredentials(provider);
  if (!configured || !clientId || !clientSecret) {
    throw new Error(`${provider} OAuth is not configured`);
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const tokenUrl = provider === "google"
    ? GOOGLE_TOKEN_URL
    : `${microsoftAuthBase()}/token`;

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `Token refresh failed (${res.status})`);
  }

  const accessToken = data.access_token as string;
  const nextRefresh = (data.refresh_token as string) || refreshToken;
  const expiresIn = Number(data.expires_in || 3600);
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  return {
    accessToken,
    refreshToken: nextRefresh,
    expiresAt,
    accountEmail: null,
  };
}

async function fetchAccountEmail(provider: CalendarProvider, accessToken: string): Promise<string | null> {
  try {
    if (provider === "google") {
      const res = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return null;
      const data: any = await res.json();
      return data.email || null;
    }
    const res = await fetch(`${microsoftGraphBase()}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data.mail || data.userPrincipalName || null;
  } catch {
    return null;
  }
}

export async function listProviderCalendars(
  provider: CalendarProvider,
  accessToken: string
): Promise<CalendarListItem[]> {
  if (provider === "google") {
    const res = await fetch(`${GOOGLE_CALENDAR_API}/users/me/calendarList`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || `List calendars failed (${res.status})`);
    return (data.items || []).map((item: any) => ({
      id: item.id as string,
      name: (item.summary as string) || item.id,
      primary: !!item.primary,
    }));
  }

  const res = await fetch(`${microsoftGraphBase()}/me/calendars`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `List calendars failed (${res.status})`);
  return (data.value || []).map((item: any) => ({
    id: item.id as string,
    name: (item.name as string) || item.id,
    primary: !!item.isDefaultCalendar,
  }));
}

export async function createProviderEvent(
  provider: CalendarProvider,
  accessToken: string,
  calendarId: string,
  event: CalendarEventInput
): Promise<CalendarEventResult> {
  if (provider === "google") {
    const calId = encodeURIComponent(calendarId || "primary");
    const body: Record<string, unknown> = {
      summary: event.title,
      description: event.description || undefined,
      start: toRfc3339(event.start, event.timezone),
      end: toRfc3339(event.end, event.timezone),
    };
    if (event.attendeeEmail) {
      body.attendees = [{ email: event.attendeeEmail, displayName: event.attendeeName || undefined }];
    }
    const res = await fetch(`${GOOGLE_CALENDAR_API}/calendars/${calId}/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || `Create Google event failed (${res.status})`);
    return { eventId: data.id, htmlLink: data.htmlLink || null };
  }

  // Outlook / Microsoft Graph
  const body: Record<string, unknown> = {
    subject: event.title,
    body: {
      contentType: "Text",
      content: event.description || "",
    },
    start: {
      dateTime: event.start.toISOString().replace(/\.\d{3}Z$/, ""),
      timeZone: event.timezone || "UTC",
    },
    end: {
      dateTime: event.end.toISOString().replace(/\.\d{3}Z$/, ""),
      timeZone: event.timezone || "UTC",
    },
  };
  if (event.attendeeEmail) {
    body.attendees = [
      {
        emailAddress: {
          address: event.attendeeEmail,
          name: event.attendeeName || event.attendeeEmail,
        },
        type: "required",
      },
    ];
  }

  const path = calendarId && calendarId !== "primary"
    ? `${microsoftGraphBase()}/me/calendars/${encodeURIComponent(calendarId)}/events`
    : `${microsoftGraphBase()}/me/events`;

  const res = await fetch(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Create Outlook event failed (${res.status})`);
  return { eventId: data.id, htmlLink: data.webLink || null };
}
