// ─── Gmail OAuth (BYOT — send SDR email from the user's own Gmail) ────────────
// Same Google Cloud app as Calendar (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).
// Redirect URI to add in Google Cloud Console:
//   {BASE_URL}/api/gmail/oauth/callback

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
export const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

/** Minimal scopes for n8n-style “send as me” + identify the account */
export const GMAIL_OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send",
].join(" ");

export function getAppBaseUrl(): string {
  const raw = process.env.BASE_URL || process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  return raw.replace(/\/$/, "");
}

export function gmailOAuthCallbackUrl(): string {
  return `${getAppBaseUrl()}/api/gmail/oauth/callback`;
}

export function frontendGmailReturnUrl(query: Record<string, string> = {}): string {
  const qs = new URLSearchParams(query).toString();
  return `${getAppBaseUrl()}/sdr-setup${qs ? `?${qs}` : ""}`;
}

export function getGoogleOAuthCredentials(): {
  clientId: string | null;
  clientSecret: string | null;
  configured: boolean;
} {
  const clientId = process.env.GOOGLE_CLIENT_ID || null;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || null;
  return { clientId, clientSecret, configured: !!(clientId && clientSecret) };
}

export function buildGmailAuthorizeUrl(state: string): string {
  const { clientId, configured } = getGoogleOAuthCredentials();
  if (!configured || !clientId) {
    throw new Error("Gmail OAuth is not configured (missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)");
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: gmailOAuthCallbackUrl(),
    response_type: "code",
    scope: GMAIL_OAUTH_SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export interface GmailTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  accountEmail: string | null;
}

export async function exchangeGmailAuthorizationCode(code: string): Promise<GmailTokenSet> {
  const { clientId, clientSecret, configured } = getGoogleOAuthCredentials();
  if (!configured || !clientId || !clientSecret) {
    throw new Error("Gmail OAuth is not configured");
  }

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: gmailOAuthCallbackUrl(),
    grant_type: "authorization_code",
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
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
  const accountEmail = await fetchGoogleEmail(accessToken);

  return { accessToken, refreshToken, expiresAt, accountEmail };
}

export async function refreshGmailAccessToken(refreshToken: string): Promise<GmailTokenSet> {
  const { clientId, clientSecret, configured } = getGoogleOAuthCredentials();
  if (!configured || !clientId || !clientSecret) {
    throw new Error("Gmail OAuth is not configured");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `Token refresh failed (${res.status})`);
  }

  return {
    accessToken: data.access_token as string,
    refreshToken: (data.refresh_token as string) || refreshToken,
    expiresAt: new Date(Date.now() + Number(data.expires_in || 3600) * 1000),
    accountEmail: null,
  };
}

async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data: any = await res.json().catch(() => ({}));
    return typeof data.email === "string" ? data.email : null;
  } catch {
    return null;
  }
}
