/**
 * Module 3 — SDR Config Panel helpers (theme usage / upgrade prompt logic)
 * Run: npx tsx --test tests/m3-ui-helpers.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "path";
import { fileURLToPath } from "node:url";

// theme.js is ESM JSX-free — import directly via dynamic path from repo root
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const {
  usageRatio,
  isNearLimit,
  formatDuration,
  USAGE_WARN_RATIO,
} = await import(path.join(root, "client/src/theme.js"));

describe("M3 usage helpers", () => {
  it("usageRatio clamps against zero/missing limits", () => {
    assert.equal(usageRatio(10, 0), 0);
    assert.equal(usageRatio(50, 100), 0.5);
    assert.equal(usageRatio(100, 100), 1);
  });

  it("isNearLimit triggers at 90% by default", () => {
    assert.equal(USAGE_WARN_RATIO, 0.9);
    assert.equal(isNearLimit(89, 100), false);
    assert.equal(isNearLimit(90, 100), true);
    assert.equal(isNearLimit(100, 100), true);
  });

  it("formatDuration renders mm:ss", () => {
    assert.equal(formatDuration(null), "—");
    assert.equal(formatDuration(65), "1:05");
    assert.equal(formatDuration(0), "0:00");
  });
});

describe("M3 component inventory", () => {
  const require = createRequire(import.meta.url);
  const fs = require("fs");

  const expected = [
    "client/src/components/sdr/PromptEditor.jsx",
    "client/src/components/sdr/KnowledgeBaseInput.jsx",
    "client/src/components/sdr/SMSTemplateEditor.jsx",
    "client/src/components/sdr/EmailTemplateEditor.jsx",
    "client/src/components/sdr/ThresholdSettings.jsx",
    "client/src/components/sdr/ExecutionLogTable.jsx",
    "client/src/components/sdr/SDRAnalytics.jsx",
    "client/src/components/calling/CallLogTable.jsx",
    "client/src/components/calling/RecordingPlayer.jsx",
    "client/src/components/calling/TranscriptViewer.jsx",
    "client/src/components/calling/CallingAnalyticsCards.jsx",
    "client/src/components/billing/UsageBar.jsx",
    "client/src/components/billing/UpgradePrompt.jsx",
    "client/src/components/billing/TierBadge.jsx",
    "client/src/pages/SDRConfigPage.jsx",
    "client/src/pages/CallingPanelPage.jsx",
    "client/src/theme.js",
  ];

  for (const rel of expected) {
    it(`ships ${rel}`, () => {
      assert.equal(fs.existsSync(path.join(root, rel)), true);
    });
  }
});
