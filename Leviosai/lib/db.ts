import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";
import "dotenv/config";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(".env");
}

// Parse DATABASE_URL to extract components (pg truncates usernames with dots)
const dbUrl = new URL(process.env.DATABASE_URL);

// Create connection pool with Supabase-friendly settings
const pool = new Pool({
  user: decodeURIComponent(dbUrl.username),
  password: decodeURIComponent(dbUrl.password),
  host: dbUrl.hostname,
  port: parseInt(dbUrl.port || "5432"),
  database: dbUrl.pathname.slice(1),
  ssl: { rejectUnauthorized: false }, // Required for Supabase
  max: 10, // Max connections in pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Log connection status
pool.on("connect", () => {
  console.log("✅ Database pool: new connection established");
});

pool.on("error", (err) => {
  console.error("❌ Database pool error:", err.message);
});

// Initialize Drizzle with full schema (enables relational queries)
export const db = drizzle(pool, { schema });

// Health check function
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    const result = await pool.query("SELECT NOW() as time");
    console.log(`✅ Database connected at ${result.rows[0].time}`);
    return true;
  } catch (error: any) {
    console.error("❌ Database connection failed:", error.message);
    return false;
  }
}

// Graceful shutdown
export async function closeDatabaseConnection(): Promise<void> {
  await pool.end();
  console.log("Database pool closed");
}

export { pool };
