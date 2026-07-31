// Idempotent ALTER helpers for Module 10 calendar columns

import { sql } from "drizzle-orm";
import { db } from "../db.js";

let columnsReady = false;

export async function ensureAppointmentCalendarColumns(): Promise<void> {
  if (columnsReady) return;
  await db.execute(sql`
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS calendar_provider TEXT
  `);
  await db.execute(sql`
    ALTER TABLE sdr_call_sessions ADD COLUMN IF NOT EXISTS booked_scheduled_at TIMESTAMP
  `);
  columnsReady = true;
}
