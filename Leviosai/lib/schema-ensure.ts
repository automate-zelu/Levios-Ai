import { sql } from "drizzle-orm";
import { db } from "./db.js";

let ready = false;

/** Adds test-credit columns so login/workspace queries do not 500 on older DBs. */
export async function ensureTestCreditColumn(): Promise<void> {
  if (ready) return;
  try {
    await db.execute(sql`
      ALTER TABLE workspaces
      ADD COLUMN IF NOT EXISTS monthly_test_minutes_used INTEGER NOT NULL DEFAULT 0
    `);
    await db.execute(sql`
      ALTER TABLE sdr_configs
      ADD COLUMN IF NOT EXISTS stt_model TEXT
    `);
    await db.execute(sql`
      ALTER TABLE sdr_configs
      ADD COLUMN IF NOT EXISTS llm_model TEXT
    `);
    await db.execute(sql`
      ALTER TABLE sdr_configs
      ADD COLUMN IF NOT EXISTS tts_model TEXT
    `);
    ready = true;
  } catch (err: any) {
    console.error("ensureTestCreditColumn:", err?.message || err);
  }
  try {
    await db.execute(sql`
      ALTER TABLE workspaces
      ALTER COLUMN monthly_minutes_used TYPE DOUBLE PRECISION
      USING monthly_minutes_used::double precision
    `);
  } catch {
    /* already a float, or no permission in tests */
  }
}
