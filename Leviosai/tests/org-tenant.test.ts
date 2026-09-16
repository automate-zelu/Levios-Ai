/**
 * Tenant model: users share an organization; SDR is 1:1 with that org.
 * Run: npx tsx --test tests/org-tenant.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("organization is the shared tenant", () => {
  it("keeps workspace as an internal 1:1 SDR row on the org", () => {
    const schema = readFileSync(path.join(root, "lib/schema.ts"), "utf8");
    assert.match(schema, /organizationId:.*notNull\(\)\.unique\(\)/);
    assert.match(schema, /Not a separate tenant|internal 1:1/i);

    const tenant = readFileSync(path.join(root, "lib/org-tenant.ts"), "utf8");
    assert.match(tenant, /export async function ensureOrgSdr/);
    assert.match(tenant, /User {2}N ── 1 {2}Organization|Users never own/);

    assert.ok(existsSync(path.join(root, "lib/org-tenant.ts")));
  });

  it("resolves SDR from organizationId so invited teammates share the agent", () => {
    const scope = readFileSync(path.join(root, "middleware/workspaceScope.ts"), "utf8");
    assert.match(scope, /ensureOrgSdr/);
    assert.match(scope, /req\.organizationId/);
    assert.doesNotMatch(scope, /req as any\)\.workspaceId/);

    const auth = readFileSync(path.join(root, "routes/auth.ts"), "utf8");
    assert.match(auth, /ensureOrgSdr/);
    assert.doesNotMatch(auth, /insert\(workspaces\)/);

    const team = readFileSync(path.join(root, "routes/team.ts"), "utf8");
    assert.match(team, /ensureOrgSdr/);
  });
});
