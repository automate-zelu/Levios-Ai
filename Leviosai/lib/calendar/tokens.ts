// ─── Calendar OAuth connection storage (encrypted tokens) ────────────────────

import { sql, eq, and } from "drizzle-orm";
import { db } from "../db.js";
import { calendarConnections } from "../schema.js";
import { encrypt, decrypt } from "../crypto.js";
import type { CalendarProvider } from "./types.js";
import { isCalendarProvider } from "./types.js";

let tableReady = false;

export async function ensureCalendarConnectionsTable(): Promise<void> {
  if (tableReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS calendar_connections (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      account_email TEXT,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      token_expires_at TIMESTAMP,
      calendar_id TEXT NOT NULL DEFAULT 'primary',
      scopes TEXT,
      connected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (organization_id, provider)
    )
  `);
  tableReady = true;
}

export interface StoredCalendarConnection {
  id: number;
  organizationId: number;
  provider: CalendarProvider;
  accountEmail: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  calendarId: string;
  scopes: string | null;
  connectedAt: Date;
  updatedAt: Date;
}

function mapRow(row: typeof calendarConnections.$inferSelect): StoredCalendarConnection | null {
  if (!isCalendarProvider(row.provider)) return null;
  return {
    id: row.id,
    organizationId: row.organizationId,
    provider: row.provider,
    accountEmail: row.accountEmail,
    accessToken: decrypt(row.accessToken),
    refreshToken: row.refreshToken ? decrypt(row.refreshToken) : null,
    tokenExpiresAt: row.tokenExpiresAt,
    calendarId: row.calendarId || "primary",
    scopes: row.scopes,
    connectedAt: row.connectedAt,
    updatedAt: row.updatedAt,
  };
}

export async function listCalendarConnections(organizationId: number): Promise<StoredCalendarConnection[]> {
  await ensureCalendarConnectionsTable();
  const rows = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.organizationId, organizationId));
  return rows.map(mapRow).filter((r): r is StoredCalendarConnection => !!r);
}

export async function getCalendarConnection(
  organizationId: number,
  provider: CalendarProvider
): Promise<StoredCalendarConnection | null> {
  await ensureCalendarConnectionsTable();
  const [row] = await db
    .select()
    .from(calendarConnections)
    .where(
      and(
        eq(calendarConnections.organizationId, organizationId),
        eq(calendarConnections.provider, provider)
      )
    );
  return row ? mapRow(row) : null;
}

export async function upsertCalendarConnection(input: {
  organizationId: number;
  provider: CalendarProvider;
  accountEmail: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  calendarId?: string;
  scopes?: string | null;
}): Promise<void> {
  await ensureCalendarConnectionsTable();
  const existing = await getCalendarConnection(input.organizationId, input.provider);
  const encAccess = encrypt(input.accessToken);
  const encRefresh = input.refreshToken ? encrypt(input.refreshToken) : null;

  if (existing) {
    await db
      .update(calendarConnections)
      .set({
        accountEmail: input.accountEmail ?? existing.accountEmail,
        accessToken: encAccess,
        refreshToken: encRefresh ?? (existing.refreshToken ? encrypt(existing.refreshToken) : null),
        tokenExpiresAt: input.tokenExpiresAt,
        calendarId: input.calendarId || existing.calendarId || "primary",
        scopes: input.scopes ?? existing.scopes,
        updatedAt: new Date(),
      })
      .where(eq(calendarConnections.id, existing.id));
    return;
  }

  await db.insert(calendarConnections).values({
    organizationId: input.organizationId,
    provider: input.provider,
    accountEmail: input.accountEmail,
    accessToken: encAccess,
    refreshToken: encRefresh,
    tokenExpiresAt: input.tokenExpiresAt,
    calendarId: input.calendarId || "primary",
    scopes: input.scopes ?? null,
  });
}

export async function updateConnectionTokens(
  organizationId: number,
  provider: CalendarProvider,
  tokens: { accessToken: string; refreshToken?: string | null; tokenExpiresAt: Date | null }
): Promise<void> {
  const existing = await getCalendarConnection(organizationId, provider);
  if (!existing) return;
  await db
    .update(calendarConnections)
    .set({
      accessToken: encrypt(tokens.accessToken),
      refreshToken:
        tokens.refreshToken != null
          ? encrypt(tokens.refreshToken)
          : existing.refreshToken
            ? encrypt(existing.refreshToken)
            : null,
      tokenExpiresAt: tokens.tokenExpiresAt,
      updatedAt: new Date(),
    })
    .where(eq(calendarConnections.id, existing.id));
}

export async function updateSelectedCalendar(
  organizationId: number,
  provider: CalendarProvider,
  calendarId: string
): Promise<StoredCalendarConnection | null> {
  const existing = await getCalendarConnection(organizationId, provider);
  if (!existing) return null;
  const [row] = await db
    .update(calendarConnections)
    .set({ calendarId, updatedAt: new Date() })
    .where(eq(calendarConnections.id, existing.id))
    .returning();
  return row ? mapRow(row) : null;
}

export async function deleteCalendarConnection(
  organizationId: number,
  provider: CalendarProvider
): Promise<boolean> {
  await ensureCalendarConnectionsTable();
  const deleted = await db
    .delete(calendarConnections)
    .where(
      and(
        eq(calendarConnections.organizationId, organizationId),
        eq(calendarConnections.provider, provider)
      )
    )
    .returning();
  return deleted.length > 0;
}
