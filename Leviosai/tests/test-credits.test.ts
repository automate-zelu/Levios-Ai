/**
 * Free test minutes vs paid calling minutes.
 * Run: npx tsx --test tests/test-credits.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "path";
import { fileURLToPath } from "node:url";
import {
  billableTestSeconds,
  decideTestCallStart,
  formatMmSs,
  minutesToSeconds,
  planTestCreditConsume,
  sessionBudgetSeconds,
  snapshotTestCredits,
  testCallClock,
} from "../lib/test-credits.js";
import { TIER_LIMITS } from "../lib/tiers.js";
import { buildAgentStack, recordWorkspaceLatency, DEFAULT_AGENT_STACK } from "../lib/agent-stack.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const starterFree = TIER_LIMITS.starter.monthlyTestMinuteLimit;
const starterFreeSeconds = minutesToSeconds(starterFree);

describe("billable test seconds", () => {
  it("bills exact connected seconds with no minute round-up", () => {
    assert.equal(billableTestSeconds(0), 0);
    assert.equal(billableTestSeconds(1), 1);
    assert.equal(billableTestSeconds(12), 12);
    assert.equal(billableTestSeconds(60), 60);
    assert.equal(billableTestSeconds(61), 61);
    assert.equal(formatMmSs(12), "0:12");
    assert.equal(formatMmSs(75), "1:15");
  });
});

describe("test credit snapshot", () => {
  it("uses free pool while complimentary minutes remain", () => {
    const snap = snapshotTestCredits({
      tier: "starter",
      testUsed: 4 * 60,
      paidUsed: 10,
      paidLimit: 1000,
    });
    assert.equal(snap.testLimitMinutes, 20);
    assert.equal(snap.testLimitSeconds, 20 * 60);
    assert.equal(snap.testRemainingSeconds, 16 * 60);
    assert.equal(snap.pool, "free_test");
    assert.equal(snap.usingPaid, false);
    assert.equal(snap.allowed, true);
  });

  it("alerts onto paid minutes when free test minutes are gone", () => {
    const snap = snapshotTestCredits({
      tier: "starter",
      testUsed: starterFreeSeconds,
      paidUsed: 10,
      paidLimit: 1000,
    });
    assert.equal(snap.pool, "paid");
    assert.equal(snap.usingPaid, true);
    assert.equal(snap.allowed, true);
    assert.match(snap.message, /paid calling minutes/i);
  });

  it("blocks when free and paid minutes are exhausted", () => {
    const snap = snapshotTestCredits({
      tier: "starter",
      testUsed: starterFreeSeconds,
      paidUsed: 1000,
      paidLimit: 1000,
    });
    assert.equal(snap.pool, "blocked");
    assert.equal(snap.allowed, false);
  });
});

describe("user declines paid monthly credits", () => {
  it("does not start a test when free minutes are gone and user says no", () => {
    const snap = snapshotTestCredits({
      tier: "starter",
      testUsed: starterFreeSeconds,
      paidUsed: 100,
      paidLimit: 1000,
    });
    const decision = decideTestCallStart({ snapshot: snap, allowPaid: false });
    assert.equal(decision.start, false);
    assert.equal(decision.reason, "declined_paid");
    assert.match(decision.message, /did not start/i);
    assert.match(decision.message, /no monthly call credits were consumed/i);
  });

  it("starts when free minutes are gone and user allows paid credits", () => {
    const snap = snapshotTestCredits({
      tier: "starter",
      testUsed: starterFreeSeconds,
      paidUsed: 100,
      paidLimit: 1000,
    });
    const decision = decideTestCallStart({ snapshot: snap, allowPaid: true });
    assert.equal(decision.start, true);
    assert.equal(decision.reason, "ok");
  });

  it("starts on remaining free minutes without asking for paid credits", () => {
    const snap = snapshotTestCredits({
      tier: "growth",
      testUsed: 5 * 60,
      paidUsed: 0,
      paidLimit: 4000,
    });
    const decision = decideTestCallStart({ snapshot: snap, allowPaid: false });
    assert.equal(decision.start, true);
    assert.equal(snap.usingPaid, false);
  });

  it("bills nothing to paid minutes when user declined and free pool is empty", () => {
    const plan = planTestCreditConsume({
      seconds: 180,
      testUsed: starterFreeSeconds,
      testLimit: starterFreeSeconds,
      paidUsed: 100,
      paidLimit: 1000,
      allowPaid: false,
    });
    assert.equal(plan.allowed, false);
    assert.equal(plan.testDelta, 0);
    assert.equal(plan.paidDelta, 0);
    assert.equal(plan.pool, "declined_paid");
    assert.equal(plan.declinedPaid, true);
  });

  it("uses leftover free seconds only when a long test would overflow and user declined paid", () => {
    const plan = planTestCreditConsume({
      seconds: 5 * 60,
      testUsed: 18 * 60,
      testLimit: starterFreeSeconds,
      paidUsed: 50,
      paidLimit: 1000,
      allowPaid: false,
    });
    assert.equal(plan.allowed, true);
    assert.equal(plan.testDelta, 2 * 60);
    assert.equal(plan.paidDelta, 0);
    assert.equal(plan.declinedPaid, true);
    assert.equal(plan.usingPaid, false);
  });

  it("does not change paidUsed/paidRemaining when declined", () => {
    const before = snapshotTestCredits({
      tier: "starter",
      testUsed: starterFreeSeconds,
      paidUsed: 250,
      paidLimit: 1000,
    });
    const plan = planTestCreditConsume({
      seconds: 4 * 60,
      testUsed: before.testUsedSeconds,
      testLimit: before.testLimitSeconds,
      paidUsed: before.paidUsed,
      paidLimit: before.paidLimit,
      allowPaid: false,
    });
    assert.equal(plan.paidDelta, 0);
    assert.equal(before.paidUsed + plan.paidDelta, 250);
    assert.equal(before.paidRemaining, 750);
  });
});

describe("consume split", () => {
  it("consumes free seconds first", () => {
    const plan = planTestCreditConsume({
      seconds: 12,
      testUsed: 0,
      testLimit: starterFreeSeconds,
      paidUsed: 0,
      paidLimit: 1000,
    });
    assert.equal(plan.allowed, true);
    assert.equal(plan.testDelta, 12);
    assert.equal(plan.paidDelta, 0);
    assert.equal(plan.pool, "free_test");
  });

  it("splits across free then paid when user allows paid credits", () => {
    const plan = planTestCreditConsume({
      seconds: 5 * 60,
      testUsed: 18 * 60,
      testLimit: starterFreeSeconds,
      paidUsed: 0,
      paidLimit: 1000,
      allowPaid: true,
    });
    assert.equal(plan.testDelta, 2 * 60);
    assert.equal(plan.paidDeltaSeconds, 3 * 60);
    assert.equal(plan.paidDelta, 3);
    assert.equal(plan.pool, "split");
    assert.equal(plan.usingPaid, true);
    assert.match(plan.message, /paid/);
  });

  it("uses only paid seconds after free are gone if user allows", () => {
    const plan = planTestCreditConsume({
      seconds: 12,
      testUsed: starterFreeSeconds,
      testLimit: starterFreeSeconds,
      paidUsed: 50,
      paidLimit: 1000,
      allowPaid: true,
    });
    assert.equal(plan.testDelta, 0);
    assert.equal(plan.paidDeltaSeconds, 12);
    assert.equal(plan.paidDelta, 12 / 60);
    assert.equal(plan.pool, "paid");
  });

  it("caps billing to remaining seconds when the session overruns", () => {
    const plan = planTestCreditConsume({
      seconds: 90,
      testUsed: starterFreeSeconds,
      testLimit: starterFreeSeconds,
      paidUsed: 999,
      paidLimit: 1000,
      allowPaid: true,
    });
    assert.equal(plan.allowed, true);
    assert.equal(plan.paidDeltaSeconds, 60);
    assert.equal(plan.testDelta, 0);
  });

  it("blocks when no minutes remain at all", () => {
    const plan = planTestCreditConsume({
      seconds: 12,
      testUsed: starterFreeSeconds,
      testLimit: starterFreeSeconds,
      paidUsed: 1000,
      paidLimit: 1000,
      allowPaid: true,
    });
    assert.equal(plan.allowed, false);
    assert.equal(plan.pool, "blocked");
  });
});

describe("session budget and mid-call clock", () => {
  it("limits a free-only call to remaining complimentary seconds", () => {
    const budget = sessionBudgetSeconds({
      testRemainingSeconds: 75,
      paidRemainingSeconds: 400 * 60,
      allowPaid: false,
    });
    assert.equal(budget.budgetSeconds, 75);
  });

  it("includes paid seconds in the budget only after the user allows them", () => {
    const declined = sessionBudgetSeconds({
      testRemainingSeconds: 0,
      paidRemainingSeconds: 5 * 60,
      allowPaid: false,
    });
    const allowed = sessionBudgetSeconds({
      testRemainingSeconds: 0,
      paidRemainingSeconds: 5 * 60,
      allowPaid: true,
    });
    assert.equal(declined.budgetSeconds, 0);
    assert.equal(allowed.budgetSeconds, 300);
  });

  it("ends the call when elapsed reaches the budget and bills those seconds", () => {
    const live = testCallClock(12, 75);
    assert.equal(live.exhausted, false);
    assert.equal(live.billedSeconds, 12);
    assert.equal(live.remainingSeconds, 63);
    const done = testCallClock(75, 75);
    assert.equal(done.exhausted, true);
    assert.equal(done.remainingSeconds, 0);
    assert.equal(done.billedSeconds, 75);
    const over = testCallClock(90, 75);
    assert.equal(over.exhausted, true);
    assert.equal(over.billedSeconds, 75);
  });
});

describe("tier test allowances", () => {
  it("keeps complimentary minutes at 20 / 40 / 60 / 60", () => {
    assert.equal(TIER_LIMITS.starter.monthlyTestMinuteLimit, 20);
    assert.equal(TIER_LIMITS.growth.monthlyTestMinuteLimit, 40);
    assert.equal(TIER_LIMITS.scale.monthlyTestMinuteLimit, 60);
    assert.equal(TIER_LIMITS.enterprise.monthlyTestMinuteLimit, 60);
  });
});

describe("agent stack", () => {
  it("exposes transcriber, llm, and voice stages", () => {
    assert.deepEqual(
      DEFAULT_AGENT_STACK.map((s) => s.id),
      ["transcriber", "llm", "voice"]
    );
    const built = buildAgentStack({});
    assert.equal(built.stages.length, 3);
    assert.equal(built.typicalTotalMs, 180 + 520 + 280);
    assert.equal(built.lastTotalMs, null);
  });

  it("attaches last measured latency per workspace", () => {
    recordWorkspaceLatency("ws-test", { sttMs: 140, llmMs: 610, ttsMs: 250 });
    const built = buildAgentStack({ workspaceId: "ws-test", voiceName: "Aria", llmModel: "gpt-4o-mini" });
    assert.equal(built.stages[1].selected, "gpt-4o-mini");
    assert.equal(built.stages[1].lastMs, 610);
    assert.equal(built.lastTotalMs, 1000);
    assert.ok(built.stages[0].options.length >= 1);
    assert.ok(built.stages[2].options.some((o) => o.id === "eleven_turbo_v2"));
  });

  it("lists Deepgram, OpenAI, Anthropic, and ElevenLabs models", () => {
    const built = buildAgentStack({ llmModel: "claude-sonnet-4-20250514" });
    assert.equal(built.stages[1].selected, "claude-sonnet-4-20250514");
    assert.equal(built.stages[1].provider, "Anthropic");
    assert.ok(built.stages[0].options.some((o) => o.id === "nova-3"));
    assert.ok(built.stages[1].options.some((o) => o.id === "gpt-4o"));
    assert.ok(built.stages[1].options.some((o) => o.id.startsWith("claude-")));
    assert.ok(built.stages[2].options.some((o) => o.id === "eleven_flash_v2_5"));
  });
});

describe("wiring", () => {
  it("exposes test-credit and voice-stack routes plus setup stack UI", () => {
    const sdr = readFileSync(path.join(root, "routes/sdr.ts"), "utf8");
    assert.match(sdr, /\/api\/sdr\/test-credits/);
    assert.match(sdr, /\/api\/sdr\/voice-stack/);
    assert.match(sdr, /saveVoiceStack|sttModel/);
    const stackUi = readFileSync(path.join(root, "client/src/components/sdr/AgentStack.jsx"), "utf8");
    assert.match(stackUi, /agent-stack-select/);
    assert.match(stackUi, /saveVoiceStack/);
    assert.match(sdr, /decideTestCallStart/);
    assert.match(sdr, /allowPaid/);
    const setup = readFileSync(path.join(root, "client/src/pages/SDRSetupPage.jsx"), "utf8");
    assert.match(setup, /AgentStack/);
    const agent = readFileSync(path.join(root, "client/src/pages/SDRConfigPage.jsx"), "utf8");
    assert.match(agent, /startTestCall/);
    assert.match(agent, /consentOpen/);
    assert.match(agent, /Free time only/);
    assert.match(agent, /Allow paid if free runs out/);
    assert.match(agent, /declined using paid calling minutes/);
  });
});
