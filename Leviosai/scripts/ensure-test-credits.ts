import "dotenv/config";
import { ensureTestCreditColumn } from "../lib/schema-ensure.js";
import { closeDatabaseConnection } from "../lib/db.js";

await ensureTestCreditColumn();
console.log("workspaces.monthly_test_minutes_used is ready");
await closeDatabaseConnection();
