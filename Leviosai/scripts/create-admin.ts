// ─── CREATE / PROMOTE ADMIN USER ─────────────────────────────────────────────
// CLI script to create a new Leviosai operator account or promote an existing
// user to admin role.
//
// Usage:
//   npm run create-admin                         — interactive prompt
//   npm run create-admin -- --email a@b.com      — promote existing user
//   npm run create-admin -- --email a@b.com --password secret --name "Admin"
//
// Add to package.json:
//   "create-admin": "tsx scripts/create-admin.ts"

import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "../lib/db.js";
import { users, organizations, workspaces } from "../lib/schema.js";
import { eq } from "drizzle-orm";
import { ensureOrgSdr } from "../lib/org-tenant.js";
import readline from "readline";

// ─── CLI ARGS ────────────────────────────────────────────────────────────────

const args: Record<string, string> = {};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith("--") && process.argv[i + 1]) {
    args[process.argv[i].slice(2)] = process.argv[++i];
  }
}

// ─── PROMPT HELPER ───────────────────────────────────────────────────────────

function prompt(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (hidden) {
      process.stdout.write(question);
      process.stdin.setRawMode?.(true);
      let input = "";
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (char: string) => {
        if (char === "\r" || char === "\n") {
          process.stdin.setRawMode?.(false);
          process.stdin.pause();
          rl.close();
          process.stdout.write("\n");
          resolve(input);
        } else if (char === "\u0003") {
          process.exit();
        } else {
          input += char;
          process.stdout.write("*");
        }
      });
    } else {
      rl.question(question, (answer) => { rl.close(); resolve(answer); });
    }
  });
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🛡️  Leviosai Admin User Manager\n");

  const email    = args.email    || await prompt("Email: ");
  const name     = args.name     || await prompt("Full name (for new user): ");
  const password = args.password || await prompt("Password: ", true);

  if (!email || !password) {
    console.error("❌ Email and password are required.");
    process.exit(1);
  }

  // Check if user already exists
  const [existing] = await db.select().from(users).where(eq(users.email, email));

  if (existing) {
    // Promote existing user to admin
    if (existing.role === "admin") {
      console.log(`ℹ️  ${email} is already an admin. Nothing to do.`);
      process.exit(0);
    }

    await db.update(users).set({ role: "admin" }).where(eq(users.email, email));
    console.log(`✅ ${email} promoted to admin.`);
    process.exit(0);
  }

  // Create new admin user
  const [firstName, ...rest] = (name || "Admin").split(" ");
  const lastName = rest.join(" ") || "User";

  // Admin users get their own org (or we can use a shared "Leviosai" org)
  const [org] = await db
    .insert(organizations)
    .values({ name: "Leviosai" })
    .returning();

  const passwordHash = await bcrypt.hash(password, 12);

  const [newUser] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      firstName,
      lastName,
      role: "admin",
      organizationId: org.id,
    })
    .returning();

  const sdr = await ensureOrgSdr(org.id);
  await db
    .update(workspaces)
    .set({ name: "Leviosai", tier: "enterprise", isActive: true })
    .where(eq(workspaces.id, sdr.workspaceId));

  console.log(`✅ Admin user created:`);
  console.log(`   Email:    ${newUser.email}`);
  console.log(`   Name:     ${newUser.firstName} ${newUser.lastName}`);
  console.log(`   Role:     ${newUser.role}`);
  console.log(`   User ID:  ${newUser.id}`);
  console.log(`\n   Login at: /admin-login\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
