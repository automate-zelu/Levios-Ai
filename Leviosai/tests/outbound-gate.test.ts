/**
 * Outbound billing gate — unpaid / paused blocks call, SMS, email.
 * Run: npx tsx --test tests/outbound-gate.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OUTBOUND_INACTIVE_MESSAGE,
  OUTBOUND_PAUSED_MESSAGE,
  outboundGateHttp,
} from "../lib/outbound-gate.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("outbound gate payloads", () => {
  it("uses 402 for inactive workspace and 403 for service pause", () => {
    const inactive = outboundGateHttp({
      allowed: false,
      reason: "workspace_inactive",
      message: OUTBOUND_INACTIVE_MESSAGE,
      workspaceActive: false,
      servicePaused: false,
      subscribePath: "/billing",
    });
    assert.equal(inactive.status, 402);
    assert.equal(inactive.body.outboundBlocked, true);
    assert.match(String(inactive.body.error), /locked|billing/i);

    const paused = outboundGateHttp({
      allowed: false,
      reason: "service_paused",
      message: OUTBOUND_PAUSED_MESSAGE,
      workspaceActive: true,
      servicePaused: true,
      subscribePath: "/billing",
    });
    assert.equal(paused.status, 403);
    assert.match(String(paused.body.error), /paused|payment/i);
  });

  it("wires messaging routes and UI lock surfaces", () => {
    const messaging = readFileSync(path.join(root, "routes/messaging.ts"), "utf8");
    assert.match(messaging, /denyIfOutboundBlocked/);
    assert.match(messaging, /\/api\/leads\/:id\/sms/);
    assert.match(messaging, /\/api\/leads\/:id\/email/);
    assert.match(messaging, /\/api\/leads\/:id\/call/);

    const calling = readFileSync(path.join(root, "client/src/pages/CallingPanelPage.jsx"), "utf8");
    assert.match(calling, /OutboundBlockedBanner|outboundBlocked/);

    const lead = readFileSync(path.join(root, "client/src/pages/LeadDetailPage.jsx"), "utf8");
    assert.match(lead, /Call locked|outboundBlocked/);

    const inbox = readFileSync(path.join(root, "client/src/pages/MessageInboxPage.jsx"), "utf8");
    assert.match(inbox, /Send locked|outboundBlocked/);
  });
});
