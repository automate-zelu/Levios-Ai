/**
 * In-browser SDR test call (no Twilio).
 * Run: npx tsx --test tests/browser-test-call.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "path";
import { fileURLToPath } from "url";
import { friendlyElevenLabsError } from "../lib/calling/elevenlabs-client.js";
import {
  appendTestCallLine,
  browserTestWsPath,
  parseTestCallClientMessage,
  testCallGreetingCue,
  testCallShellState,
} from "../lib/calling/browser-test-protocol.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("test call shell layout", () => {
  it("hides the left CRM nav and opens the right studio while live", () => {
    assert.deepEqual(testCallShellState(true), { leftNav: "hidden", rightStudio: "open" });
  });

  it("restores the left CRM nav when the right studio closes", () => {
    assert.deepEqual(testCallShellState(false), { leftNav: "open", rightStudio: "closed" });
  });
});

describe("test call protocol", () => {
  it("parses start, end, typed text, and pcm frames", () => {
    assert.equal(parseTestCallClientMessage('{"type":"start"}').type, "start");
    assert.equal(parseTestCallClientMessage('{"type":"end"}').type, "end");
    assert.equal(parseTestCallClientMessage('{"type":"text","text":"  hi there "}').text, "hi there");
    const pcm = parseTestCallClientMessage({
      type: "pcm",
      data: Buffer.from("abcd").toString("base64"),
    });
    assert.equal(pcm.type, "pcm");
    assert.equal(pcm.pcm?.toString(), "abcd");
  });

  it("rejects empty text, bad json, and unknown types", () => {
    assert.equal(parseTestCallClientMessage("not-json").type, "unknown");
    assert.equal(parseTestCallClientMessage({ type: "text", text: "   " }).type, "unknown");
    assert.equal(parseTestCallClientMessage({ type: "pcm", data: "" }).type, "unknown");
    assert.equal(parseTestCallClientMessage({ type: "nope" }).type, "unknown");
  });

  it("appends two-way transcript lines and skips blanks", () => {
    let lines = appendTestCallLine([], "agent", "Hi, is now a good time?");
    lines = appendTestCallLine(lines, "you", "Yes, who is this?");
    lines = appendTestCallLine(lines, "you", "   ");
    assert.equal(lines.length, 2);
    assert.equal(lines[0].speaker, "agent");
    assert.equal(lines[1].speaker, "you");
  });

  it("builds a rehearsal greeting cue that is not a live outbound phone event", () => {
    const cue = testCallGreetingCue("Aria");
    assert.match(cue, /TEST_CALL_CONNECTED/);
    assert.match(cue, /Aria/);
    assert.match(cue, /not a live phone call/i);
    assert.equal(browserTestWsPath("abc-1"), "/api/sdr/test-call/abc-1");
  });
});

describe("test call voice errors", () => {
  it("explains ElevenLabs payment failures in plain language", () => {
    const msg = friendlyElevenLabsError(401, '{"detail":{"code":"payment_issue"}}');
    assert.match(msg, /invoice|payment/i);
    assert.doesNotMatch(msg, /ddd0d906/);
  });
});

describe("test call wiring", () => {
  it("exposes start route, websocket upgrade, and SDR Agent Test call control", () => {
    const sdr = readFileSync(path.join(root, "routes/sdr.ts"), "utf8");
    assert.match(sdr, /\/api\/sdr\/test-call/);
    const server = readFileSync(path.join(root, "server.ts"), "utf8");
    assert.match(server, /handleBrowserTestCallStream/);
    const page = readFileSync(path.join(root, "client/src/pages/SDRConfigPage.jsx"), "utf8");
    assert.match(page, /TestCallStudio/);
    assert.match(page, /sdr-agent-toolbar/);
    assert.match(page, /Test call/);
    const studio = readFileSync(path.join(root, "client/src/components/sdr/TestCallStudio.jsx"), "utf8");
    assert.match(studio, /End call/);
    assert.match(studio, /Allow mic/);
    assert.match(studio, /getUserMedia/);
    assert.match(studio, /speechSynthesis/);
    const eleven = readFileSync(path.join(root, "lib/calling/elevenlabs-client.ts"), "utf8");
    assert.match(eleven, /friendlyElevenLabsError/);
    const session = readFileSync(path.join(root, "lib/calling/browser-test-session.ts"), "utf8");
    assert.match(session, /minutes_exhausted/);
    assert.match(session, /budgetSeconds/);
    const app = readFileSync(path.join(root, "client/src/App.jsx"), "utf8");
    assert.match(app, /is-test-call/);
    assert.match(app, /onTestCallActive/);
  });
});
