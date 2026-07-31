// ─── OAuth config + URL builders (pure helpers for Module 10) ────────────────

import type { CalendarProvider } from "./types.js";
import { isCalendarProvider } from "./types.js";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
export const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

export const MICROSOFT_SCOPES = [
  "openid",
  "email",
  "offline_access",
  "User.Read",
  "Calendars.ReadWrite",
].join(" ");

/**
 * Always multi-tenant "common" — any personal or work Microsoft account can sign in.
 * Same model as n8n / most SaaS products: the *user* never enters a tenant id.
 * Levios registers one Azure app; users just click Connect → Microsoft login.
 */
export function microsoftAuthBase(): string {
  return "https://login.microsoftonline.com/common/oauth2/v2.0";
}

export function microsoftGraphBase(): string {
  return "https://graph.microsoft.com/v1.0";
}

/**
 * Outlook calendar OAuth is paused until Microsoft app setup is ready.
 * Google remains fully enabled. Flip to true to restore Outlook Connect.
 */
export const OUTLOOK_CALENDAR_ENABLED = false;

export function isCalendarProviderEnabled(provider: CalendarProvider): boolean {
  if (provider === "google") return true;
  if (provider === "outlook") return OUTLOOK_CALENDAR_ENABLED;
  return false;
}

export function getAppBaseUrl(): string {
  const raw = process.env.BASE_URL || process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  return raw.replace(/\/$/, "");
}

export function oauthCallbackPath(provider: CalendarProvider): string {
  return `/api/calendar/oauth/${provider}/callback`;
}

export function oauthCallbackUrl(provider: CalendarProvider): string {
  return `${getAppBaseUrl()}${oauthCallbackPath(provider)}`;
}

export function frontendCalendarReturnUrl(query: Record<string, string> = {}): string {
  const qs = new URLSearchParams(query).toString();
  return `${getAppBaseUrl()}/settings${qs ? `?${qs}` : ""}`;
}

export function getProviderClientCredentials(provider: CalendarProvider): {
  clientId: string | null;
  clientSecret: string | null;
  configured: boolean;
} {
  if (provider === "google") {
    const clientId = process.env.GOOGLE_CLIENT_ID || null;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || null;
    return { clientId, clientSecret, configured: !!(clientId && clientSecret) };
  }
  const clientId = process.env.MICROSOFT_CLIENT_ID || null;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET || null;
  return { clientId, clientSecret, configured: !!(clientId && clientSecret) };
}

export function buildAuthorizeUrl(provider: CalendarProvider, state: string): string {
  const { clientId, configured } = getProviderClientCredentials(provider);
  if (!configured || !clientId) {
    throw new Error(`${provider} OAuth is not configured (missing client id/secret)`);
  }

  const redirectUri = oauthCallbackUrl(provider);

  if (provider === "google") {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPES,
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return `${GOOGLE_AUTH_URL}?${params}`;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: MICROSOFT_SCOPES,
    response_mode: "query",
    state,
  });
  return `${microsoftAuthBase()}/authorize?${params}`;
}

export function parseProviderParam(value: string | undefined): CalendarProvider | null {
  if (!value) return null;
  const normalized = value === "google_calendar" ? "google" : value;
  return isCalendarProvider(normalized) ? normalized : null;
}

export function integrationIdForProvider(provider: CalendarProvider): string {
  return provider === "google" ? "google_calendar" : "outlook";
}

export function providerFromIntegrationId(id: string): CalendarProvider | null {
  if (id === "google_calendar" || id === "google") return "google";
  if (id === "outlook") return "outlook";
  return null;
}
