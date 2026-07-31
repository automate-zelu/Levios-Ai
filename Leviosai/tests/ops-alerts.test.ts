/**
 * Ops alerts — Twilio provision failure email helpers
 * Run: npx tsx --test tests/ops-alerts.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTwilioProvisionFailureEmail,
  getOpsAlertEmail,
} from "../lib/ops-alerts.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("ops Twilio provision failure email", () => {
  it("builds subject and body with workspace + error + admin CTA", () => {
    const { subject, text, html } = buildTwilioProvisionFailureEmail({
      workspaceId: "ws-123",
      workspaceName: "Acme Solar",
      organizationId: 42,
      errorMessage: "TWILIO_MASTER_SID missing",
      baseUrl: "https://app.leviosai.io",
    });
    assert.match(subject, /Acme Solar/);
    assert.match(text, /ws-123/);
    assert.match(text, /TWILIO_MASTER_SID missing/);
    assert.match(text, /Organization ID: 42/);
    assert.match(text, /https:\/\/app\.leviosai\.io\/admin/);
    assert.match(html, /Provision Twilio/);
    assert.match(html, /Acme Solar/);
  });

  it("escapes HTML in error messages", () => {
    const { html } = buildTwilioProvisionFailureEmail({
      workspaceId: "w",
      workspaceName: "X",
      errorMessage: '<script>alert("x")</script>',
    });
    assert.ok(!html.includes("<script>"));
    assert.match(html, /&lt;script&gt;/);
  });

  it("reads OPS_ALERT_EMAIL from env", () => {
    const prev = process.env.OPS_ALERT_EMAIL;
    process.env.OPS_ALERT_EMAIL = " ops@leviosai.io ";
    try {
      assert.equal(getOpsAlertEmail(), "ops@leviosai.io");
    } finally {
      if (prev === undefined) delete process.env.OPS_ALERT_EMAIL;
      else process.env.OPS_ALERT_EMAIL = prev;
    }
  });

  it("wires Stripe activate path to provision + ops notify", () => {
    const src = readFileSync(path.join(root, "lib/stripe.ts"), "utf8");
    assert.match(src, /provisionWorkspace/);
    assert.match(src, /notifyTwilioProvisionFailed/);
    assert.ok(existsSync(path.join(root, "lib/ops-alerts.ts")));
  });
});
