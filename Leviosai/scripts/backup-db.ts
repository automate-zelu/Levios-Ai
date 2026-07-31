// ─── DATABASE BACKUP SCRIPT ───────────────────────────────────────────────────
// Exports every table in the public schema as a restorable .sql file.
// No pg_dump required — runs via: npx tsx scripts/backup-db.ts
//
// Output: backups/backup_YYYY-MM-DD_HH-MM-SS.sql
//
// The file contains:
//   1. Table DDL   — CREATE TABLE IF NOT EXISTS (schema pulled from information_schema)
//   2. Row data    — INSERT INTO ... ON CONFLICT DO NOTHING  (safe to re-run)
//
// To restore on any PostgreSQL database:
//   psql <connection-string> -f backups/backup_YYYY-MM-DD_HH-MM-SS.sql

import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── CONNECTION ───────────────────────────────────────────────────────────────

const dbUrl = new URL(process.env.DATABASE_URL!);
const pool = new Pool({
  user:     decodeURIComponent(dbUrl.username),
  password: decodeURIComponent(dbUrl.password),
  host:     dbUrl.hostname,
  port:     parseInt(dbUrl.port || "5432"),
  database: dbUrl.pathname.slice(1),
  ssl:      { rejectUnauthorized: false },
  max: 2,
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function escapeValue(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean")          return val ? "TRUE" : "FALSE";
  if (typeof val === "number")           return String(val);
  if (val instanceof Date)               return `'${val.toISOString()}'`;
  if (typeof val === "object")           return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
  return `'${String(val).replace(/'/g, "''")}'`;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function backup() {
  const client = await pool.connect();

  try {
    // 1. Get all user tables in the public schema (excludes Supabase internal tables)
    const tablesResult = await client.query<{ tablename: string }>(`
      SELECT tablename
      FROM   pg_tables
      WHERE  schemaname = 'public'
      ORDER  BY tablename
    `);

    const tables = tablesResult.rows.map(r => r.tablename);
    console.log(`\n📦 Found ${tables.length} tables: ${tables.join(", ")}\n`);

    const lines: string[] = [];
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

    // Header
    lines.push(`-- ═══════════════════════════════════════════════════════════`);
    lines.push(`-- Leviosai CRM — Database Backup`);
    lines.push(`-- Created:  ${new Date().toISOString()}`);
    lines.push(`-- Database: ${dbUrl.hostname}${dbUrl.pathname}`);
    lines.push(`-- Tables:   ${tables.length}`);
    lines.push(`-- ═══════════════════════════════════════════════════════════`);
    lines.push(``);
    lines.push(`SET client_encoding = 'UTF8';`);
    lines.push(`SET standard_conforming_strings = on;`);
    lines.push(``);

    for (const table of tables) {
      console.log(`  ⬇  Exporting ${table}...`);

      // 2. Get column definitions for this table
      const colResult = await client.query<{
        column_name: string;
        data_type:   string;
        is_nullable: string;
        column_default: string | null;
        character_maximum_length: number | null;
      }>(`
        SELECT
          column_name,
          data_type,
          is_nullable,
          column_default,
          character_maximum_length
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = $1
        ORDER BY ordinal_position
      `, [table]);

      const cols = colResult.rows;

      // 3. Build CREATE TABLE IF NOT EXISTS
      const colDefs = cols.map(c => {
        let type = c.data_type.toUpperCase();
        if (c.character_maximum_length) type += `(${c.character_maximum_length})`;
        let def = `  ${c.column_name} ${type}`;
        if (c.column_default)          def += ` DEFAULT ${c.column_default}`;
        if (c.is_nullable === "NO")     def += ` NOT NULL`;
        return def;
      });

      lines.push(`-- ─── TABLE: ${table} ${"─".repeat(Math.max(0, 50 - table.length))}`);
      lines.push(`CREATE TABLE IF NOT EXISTS ${table} (`);
      lines.push(colDefs.join(",\n"));
      lines.push(`);`);
      lines.push(``);

      // 4. Export rows as INSERTs
      const rowResult = await client.query(`SELECT * FROM "${table}"`);
      const rows = rowResult.rows;

      if (rows.length === 0) {
        lines.push(`-- (no rows in ${table})`);
        lines.push(``);
        continue;
      }

      const columnNames = cols.map(c => c.column_name).join(", ");

      lines.push(`-- ${rows.length} row${rows.length !== 1 ? "s" : ""}`);
      for (const row of rows) {
        const values = cols.map(c => escapeValue(row[c.column_name])).join(", ");
        lines.push(`INSERT INTO "${table}" (${columnNames}) VALUES (${values}) ON CONFLICT DO NOTHING;`);
      }
      lines.push(``);

      console.log(`     ✅ ${rows.length} rows`);
    }

    // Footer
    lines.push(`-- ═══════════════════════════════════════════════════════════`);
    lines.push(`-- End of backup — ${tables.length} tables exported`);
    lines.push(`-- ═══════════════════════════════════════════════════════════`);

    // 5. Write file
    const backupsDir = path.resolve(__dirname, "../backups");
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir);

    const filename = `backup_${ts}.sql`;
    const filepath = path.join(backupsDir, filename);
    fs.writeFileSync(filepath, lines.join("\n"), "utf8");

    const sizeKb = Math.round(fs.statSync(filepath).size / 1024);
    console.log(`\n✅ Backup saved: backups/${filename}  (${sizeKb} KB)\n`);

  } finally {
    client.release();
    await pool.end();
  }
}

backup().catch(err => {
  console.error("❌ Backup failed:", err.message);
  process.exit(1);
});
