/**
 * P0 Catalyst client bugs — Conversation Replay, Proposals, bell, mobile viewport.
 * Run: npx tsx --test tests/p0-client-bugs.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const fs = require("fs");

const {
  formatCallDuration,
  mapCallSessionsToReplay,
  mapMessagesToReplay,
  mapActivityToFeed,
} = await import(path.join(root, "client/src/lib/conversation-replay.js"));

describe("P0 conversation-replay helpers", () => {
  it("formatCallDuration returns null for empty and mm:ss for seconds", () => {
    assert.equal(formatCallDuration(null), null);
    assert.equal(formatCallDuration(0), null);
    assert.equal(formatCallDuration(65), "1:05");
    assert.equal(formatCallDuration(125), "2:05");
  });

  it("mapCallSessionsToReplay maps API rows without inventing leads", () => {
    const rows = mapCallSessionsToReplay([
      {
        id: 42,
        leadFirstName: "Ada",
        leadLastName: "Lovelace",
        startedAt: "2026-03-01T12:00:00.000Z",
        durationSeconds: 90,
        status: "completed",
        transcript: JSON.stringify([{ speaker: "agent", text: "Hello" }, { speaker: "lead", text: "Hi" }]),
      },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "voice-42");
    assert.equal(rows[0].type, "voice");
    assert.equal(rows[0].leadName, "Ada Lovelace");
    assert.equal(rows[0].duration, "1:30");
    assert.equal(rows[0].transcript.length, 2);
    assert.equal(rows[0].transcript[1].role, "lead");
  });

  it("mapCallSessionsToReplay returns empty for empty input (no phantom demo)", () => {
    assert.deepEqual(mapCallSessionsToReplay([]), []);
    assert.deepEqual(mapCallSessionsToReplay(undefined), []);
  });

  it("mapMessagesToReplay classifies sms/email and inbound role", () => {
    const rows = mapMessagesToReplay([
      {
        id: 7,
        channel: "sms",
        direction: "inbound",
        leadFirstName: "Grace",
        leadLastName: "Hopper",
        content: "Call me back",
        createdAt: "2026-03-02T09:00:00.000Z",
      },
      {
        id: 8,
        channel: "email",
        direction: "outbound",
        leadEmail: "a@b.com",
        subject: "Follow up",
        aiGenerated: true,
        status: "sent",
      },
    ]);
    assert.equal(rows[0].type, "sms");
    assert.equal(rows[0].outcome, "replied");
    assert.equal(rows[0].transcript[0].role, "lead");
    assert.equal(rows[1].type, "email");
    assert.equal(rows[1].agent, "AI Agent");
    assert.equal(rows[1].leadName, "a@b.com");
  });

  it("mapActivityToFeed maps details and result heuristics", () => {
    const rows = mapActivityToFeed([
      { id: 1, details: "Call placed", action: "call", entityType: "lead", entityId: 9, createdAt: "2026-03-01T00:00:00.000Z" },
      { id: 2, action: "credit_added", details: "Credits topped up", entityType: "org" },
      { id: 3, action: "send_failed", details: "Delivery error", entityType: "message" },
    ]);
    assert.equal(rows[0].lead, "Lead #9");
    assert.equal(rows[0].result, "success");
    assert.equal(rows[1].result, "credit");
    assert.equal(rows[2].result, "declined");
  });
});

describe("P0 App.jsx / CSS / viewport regressions", () => {
  const appPath = path.join(root, "client/src/App.jsx");
  const cssPath = path.join(root, "client/src/styles.css");
  const htmlPath = path.join(root, "client/index.html");
  const appSrc = fs.readFileSync(appPath, "utf8");
  const cssSrc = fs.readFileSync(cssPath, "utf8");
  const htmlSrc = fs.readFileSync(htmlPath, "utf8");

  it("ships conversation-replay helper module", () => {
    assert.equal(fs.existsSync(path.join(root, "client/src/lib/conversation-replay.js")), true);
  });

  it("ConversationReplayPage loads call/message APIs, not SAMPLE_LEADS", () => {
    const start = appSrc.indexOf("function ConversationReplayPage()");
    assert.ok(start > 0, "ConversationReplayPage missing");
    const nextFn = appSrc.indexOf("\nfunction ", start + 10);
    const block = appSrc.slice(start, nextFn > 0 ? nextFn : undefined);
    assert.match(block, /callApi\.getSessions/);
    assert.match(block, /messagesApi\.recent/);
    assert.doesNotMatch(block, /SAMPLE_LEADS/);
    assert.match(block, /No conversations yet/);
  });

  it("Proposals no longer ships white-label upload UI (P2.4/P2.5)", () => {
    const start = appSrc.indexOf("function ProposalsPage()");
    assert.ok(start > 0, "ProposalsPage missing");
    const nextFn = appSrc.indexOf("\nfunction ", start + 10);
    const block = appSrc.slice(start, nextFn > 0 ? nextFn : undefined);
    assert.doesNotMatch(block, /White-Label Proposal Branding/);
    assert.doesNotMatch(block, /logoUploaded/);
    assert.match(block, /Package/);
  });

  it("notification bell is a real button with panel (no fake badge 5)", () => {
    assert.match(appSrc, /className="notif-bell-btn"/);
    assert.match(appSrc, /className="notif-panel"/);
    assert.match(appSrc, /aria-label="Notifications"/);
    assert.doesNotMatch(appSrc, />5<\/span>/);
    assert.match(cssSrc, /\.notif-bell-btn\s*\{/);
    assert.match(cssSrc, /min-width:\s*44px/);
    assert.match(cssSrc, /\.notif-panel\s*\{/);
  });

  it("mobile viewport and sidebar do not reserve flex width", () => {
    assert.match(htmlSrc, /viewport-fit=cover/);
    assert.match(htmlSrc, /overflow-x:\s*hidden/);
    assert.match(cssSrc, /flex:\s*0\s+0\s+0\s*!important/);
    assert.match(cssSrc, /\.catalyst-main[\s\S]*min-width:\s*0/);
  });
});
