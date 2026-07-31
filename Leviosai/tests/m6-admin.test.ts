/**
 * Module 6 — Admin panel helpers (usage alerts, tier options)
 * Run: npx tsx --test tests/m6-admin.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADMIN_USAGE_ALERT_RATIO,
  ADMIN_TIER_OPTIONS,
  leadUsageRatio,
  minuteUsageRatio,
  isWorkspaceNearLimit,
  usageAlertReason,
  filterUsageAlerts,
} from "../lib/admin-helpers.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("M6 admin usage alerts", () => {
  it("uses 90% threshold from plan §11.4", () => {
    assert.equal(ADMIN_USAGE_ALERT_RATIO, 0.9);
  });

  it("includes scale in admin tier options", () => {
    assert.deepEqual([...ADMIN_TIER_OPTIONS], ["starter", "growth", "scale", "enterprise"]);
  });

  it("computes lead/minute ratios and ignores unlimited", () => {
    assert.equal(leadUsageRatio({ id: "1", monthlyLeadsUsed: 90, monthlyLeadLimit: 100 }), 0.9);
    assert.equal(minuteUsageRatio({ id: "1", monthlyMinutesUsed: 50, monthlyMinuteLimit: 100 }), 0.5);
    assert.equal(leadUsageRatio({ id: "1", monthlyLeadsUsed: 999999, monthlyLeadLimit: 999_999 }), 0);
  });

  it("flags near-limit workspaces with reason", () => {
    const nearLeads = {
      id: "a",
      name: "A",
      monthlyLeadsUsed: 91,
      monthlyLeadLimit: 100,
      monthlyMinutesUsed: 10,
      monthlyMinuteLimit: 100,
    };
    const nearBoth = {
      id: "b",
      name: "B",
      monthlyLeadsUsed: 95,
      monthlyLeadLimit: 100,
      monthlyMinutesUsed: 92,
      monthlyMinuteLimit: 100,
    };
    const ok = {
      id: "c",
      name: "C",
      monthlyLeadsUsed: 10,
      monthlyLeadLimit: 100,
      monthlyMinutesUsed: 10,
      monthlyMinuteLimit: 100,
    };

    assert.equal(isWorkspaceNearLimit(nearLeads), true);
    assert.equal(usageAlertReason(nearLeads), "leads");
    assert.equal(usageAlertReason(nearBoth), "both");
    assert.equal(isWorkspaceNearLimit(ok), false);

    const alerts = filterUsageAlerts([nearLeads, nearBoth, ok]);
    assert.equal(alerts.length, 2);
    assert.equal(alerts[0].alertReason, "leads");
    assert.equal(alerts[1].alertReason, "both");
  });
});

describe("M6 admin component inventory", () => {
  const files = [
    "client/src/components/admin/PlatformAnalytics.jsx",
    "client/src/components/admin/WorkspaceList.jsx",
    "client/src/components/admin/WorkspaceDetail.jsx",
    "client/src/components/admin/StuckEnrollments.jsx",
    "client/src/pages/AdminPanel.jsx",
    "lib/admin-helpers.ts",
  ];

  for (const rel of files) {
    it(`ships ${rel}`, () => {
      assert.equal(existsSync(path.join(root, rel)), true);
    });
  }

  it("admin routes expose usage-alerts and workspace enrollments", () => {
    const src = readFileSync(path.join(root, "routes/admin.ts"), "utf8");
    assert.match(src, /\/api\/admin\/usage-alerts/);
    assert.match(src, /\/api\/admin\/workspaces\/:id\/enrollments/);
    assert.match(src, /adminLimiter/);
  });
});
