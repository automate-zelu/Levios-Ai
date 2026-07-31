// ─── Gmail connection storage (encrypted OAuth tokens per organization) ──────

import { sql, eq } from "drizzle-orm";
import { db } from "../db.js";
import { gmailConnections } from "../schema.js";
import { encrypt, decrypt } from "../crypto.js";
import { GMAIL_OAUTH_SCOPES, getGoogleOAuthCredentials, refreshGmailAccessToken } from "./oauth.js";

let tableReady = false;

export async function ensureGmailConnectionsTable(): Promise<void> {
  if (tableReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS gmail_connections (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
      account_email TEXT,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      token_expires_at TIMESTAMP,
      scopes TEXT,
      connected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  tableReady = true;
}

export interface StoredGmailConnection {
  id: number;
  organizationId: number;
  accountEmail: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scopes: string | null;
  connectedAt: Date;
  updatedAt: Date;
}

function mapRow(row: typeof gmailConnections.$inferSelect): StoredGmailConnection {
  return {
    id: row.id,
    organizationId: row.organizationId,
    accountEmail: row.accountEmail,
    accessToken: decrypt(row.accessToken),
    refreshToken: row.refreshToken ? decrypt(row.refreshToken) : null,
    tokenExpiresAt: row.tokenExpiresAt,
    scopes: row.scopes,
    connectedAt: row.connectedAt,
    updatedAt: row.updatedAt,
  };
}

export async function getGmailConnection(organizationId: number): Promise<StoredGmailConnection | null> {
  await ensureGmailConnectionsTable();
  const [row] = await db
    .select()
    .from(gmailConnections)
    .where(eq(gmailConnections.organizationId, organizationId));
  return row ? mapRow(row) : null;
}

export async function upsertGmailConnection(input: {
  organizationId: number;
  accountEmail: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scopes?: string | null;
}): Promise<void> {
  await ensureGmailConnectionsTable();
  const existing = await getGmailConnection(input.organizationId);
  const encAccess = encrypt(input.accessToken);
  const encRefresh = input.refreshToken ? encrypt(input.refreshToken) : null;

  if (existing) {
    await db
      .update(gmailConnections)
      .set({
        accountEmail: input.accountEmail ?? existing.accountEmail,
        accessToken: encAccess,
        refreshToken: encRefresh ?? (existing.refreshToken ? encrypt(existing.refreshToken) : null),
        tokenExpiresAt: input.tokenExpiresAt,
        scopes: input.scopes ?? existing.scopes,
        updatedAt: new Date(),
      })
      .where(eq(gmailConnections.id, existing.id));
    return;
  }

  await db.insert(gmailConnections).values({
    organizationId: input.organizationId,
    accountEmail: input.accountEmail,
    accessToken: encAccess,
    refreshToken: encRefresh,
    tokenExpiresAt: input.tokenExpiresAt,
    scopes: input.scopes ?? GMAIL_OAUTH_SCOPES,
  });
}

export async function deleteGmailConnection(organizationId: number): Promise<void> {
  await ensureGmailConnectionsTable();
  await db.delete(gmailConnections).where(eq(gmailConnections.organizationId, organizationId));
}

export async function getValidGmailAccessToken(organizationId: number): Promise<{
  accessToken: string;
  accountEmail: string | null;
} | null> {
  const conn = await getGmailConnection(organizationId);
  if (!conn) return null;

  const expiresSoon =
    conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() < Date.now() + 60_000;

  if (!expiresSoon) {
    return { accessToken: conn.accessToken, accountEmail: conn.accountEmail };
  }

  if (!conn.refreshToken) {
    return { accessToken: conn.accessToken, accountEmail: conn.accountEmail };
  }

  const refreshed = await refreshGmailAccessToken(conn.refreshToken);
  await upsertGmailConnection({
    organizationId,
    accountEmail: conn.accountEmail,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    tokenExpiresAt: refreshed.expiresAt,
    scopes: conn.scopes,
  });

  return { accessToken: refreshed.accessToken, accountEmail: conn.accountEmail };
}

export async function getGmailStatus(organizationId: number): Promise<{
  connected: boolean;
  accountEmail: string | null;
  oauthConfigured: boolean;
}> {
  const creds = getGoogleOAuthCredentials();
  const conn = await getGmailConnection(organizationId);
  return {
    connected: !!conn,
    accountEmail: conn?.accountEmail ?? null,
    oauthConfigured: creds.configured,
  };
}
