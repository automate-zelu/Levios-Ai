/**
 * P3 — SDR console, one-agent KB, unified inbox.
 * Run: npx tsx --test tests/p3-agents-comms.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("P3.1 SDR ops console", () => {
  it("ships SdrOpsConsole and mounts it on SDR Agent Console tab", () => {
    assert.ok(existsSync(path.join(root, "client/src/components/sdr/SdrOpsConsole.jsx")));
    const page = readFileSync(path.join(root, "client/src/pages/SDRConfigPage.jsx"), "utf8");
    assert.match(page, /SdrOpsConsole/);
    assert.match(page, /tab === "console"/);
    assert.match(page, /EnrollmentSequencesPanel|SdrOpsConsole/);
    const ops = readFileSync(
      path.join(root, "client/src/components/sdr/SdrOpsConsole.jsx"),
      "utf8"
    );
    assert.match(ops, /Needs human|Leads being worked|Appointments generated|Planned next actions/);
    assert.match(ops, /One agent for every industry/);
  });

  it("sequence panel can open lead timeline", () => {
    const src = readFileSync(
      path.join(root, "client/src/components/sdr/EnrollmentSequencesPanel.jsx"),
      "utf8"
    );
    assert.match(src, /Open timeline/);
    assert.match(src, /tab=timeline/);
  });
});

describe("P3.2 one agent × many KBs", () => {
  it("documents industry differences as KB-only on KnowledgeBaseInput", () => {
    const kb = readFileSync(
      path.join(root, "client/src/components/sdr/KnowledgeBaseInput.jsx"),
      "utf8"
    );
    assert.match(kb, /Industry differences/);
    assert.match(kb, /same agent UI/);
  });

  it("has no industry-specific agent page routes", () => {
    const app = readFileSync(path.join(root, "client/src/App.jsx"), "utf8");
    assert.doesNotMatch(app, /\/solar|\/hvac|SolarAgent|HvacAgent/);
    const pages = readFileSync(path.join(root, "client/src/pages/SDRConfigPage.jsx"), "utf8");
    assert.match(pages, /One agent for all industries/);
  });
});

describe("P3.3 unified inbox", () => {
  it("supports all channel on API and MessageInboxPage", () => {
    const api = readFileSync(path.join(root, "routes/api.ts"), "utf8");
    assert.match(api, /channel must be sms, email, or all/);
    const storage = readFileSync(path.join(root, "lib/storage.ts"), "utf8");
    assert.match(storage, /"sms" \| "email" \| "all"/);
    const inbox = readFileSync(path.join(root, "client/src/pages/MessageInboxPage.jsx"), "utf8");
    assert.match(inbox, /channel === "all"|channelProp = "all"/);
    assert.match(inbox, /Lead timeline/);
  });

  it("nav uses single Inbox; legacy routes redirect", () => {
    const app = readFileSync(path.join(root, "client/src/App.jsx"), "utf8");
    assert.match(app, /"Inbox": "\/inbox"/);
    assert.match(app, /name: "Inbox"/);
    assert.match(app, /\/inbox\?channel=sms/);
    assert.match(app, /\/inbox\?channel=email/);
    assert.doesNotMatch(app, /name: "SMS Inbox"/);
    assert.doesNotMatch(app, /name: "Email Inbox"/);
  });
});
