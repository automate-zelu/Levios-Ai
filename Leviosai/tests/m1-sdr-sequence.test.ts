/**
 * Module 1 — SDR Sequence State Machine tests
 *
 * Covers:
 *  - Valid transition map / busy-retry limits
 *  - Minute-limit → SMS fall-through chains
 *  - Stuck-enrollment recovery plans (no pre-transition bugs)
 *  - SMS_TIMEOUT / SEND_EMAIL ownership (email_sent not pre-marked)
 *
 * Run: npx tsx --test tests/m1-sdr-sequence.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TRANSITIONS,
  stateMachine,
  MAX_CALL_ATTEMPTS,
  BUSY_RETRY_DELAY_MS,
  SMS_READY_STATUSES,
  TERMINAL_STATUSES,
} from "../lib/sdr-state-machine.js";
import type { EnrollmentStatus } from "../lib/schema.js";
import {
  shouldRetryBusyCall,
  isMinuteLimitReached,
  planSmsFallthrough,
  assertFallthroughChainLegal,
  planStuckRecovery,
  assertRecoveryChainLegal,
} from "../lib/sdr-m1-logic.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function assertChain(steps: EnrollmentStatus[]) {
  for (let i = 0; i < steps.length - 1; i++) {
    const from = steps[i];
    const to = steps[i + 1];
    assert.equal(
      stateMachine.canTransition(from, to),
      true,
      `Expected legal transition ${from} → ${to}`
    );
  }
}

function assertIllegal(from: EnrollmentStatus, to: EnrollmentStatus) {
  assert.equal(
    stateMachine.canTransition(from, to),
    false,
    `Expected ILLEGAL transition ${from} → ${to}`
  );
}

// ─── 1. Transition map invariants ─────────────────────────────────────────────

describe("M1 state machine — transition map", () => {
  it("exports max 3 call attempts and 30-min busy retry delay", () => {
    assert.equal(MAX_CALL_ATTEMPTS, 3);
    assert.equal(BUSY_RETRY_DELAY_MS, 30 * 60 * 1000);
  });

  it("happy path: pending → dial → answered → booked", () => {
    assertChain([
      "pending",
      "call_initiated",
      "call_connected",
      "call_answered",
      "booked",
    ]);
  });

  it("no-answer path: call_initiated → call_no_answer → sms_sent → email_sent → exhausted", () => {
    assertChain([
      "pending",
      "call_initiated",
      "call_no_answer",
      "sms_sent",
      "email_sent",
      "exhausted",
    ]);
  });

  it("busy retry path: call_initiated → call_busy → call_initiated", () => {
    assertChain(["call_initiated", "call_busy", "call_initiated"]);
  });

  it("busy max → SMS: call_busy → sms_sent (NOT call_no_answer)", () => {
    assert.equal(stateMachine.canTransition("call_busy", "sms_sent"), true);
    assertIllegal("call_busy", "call_no_answer"); // the old bug
  });

  it("failed call → SMS: call_failed → sms_sent", () => {
    assertChain(["call_initiated", "call_failed", "sms_sent"]);
  });

  it("SMS reply and email reply can complete or exhaust", () => {
    assertChain(["sms_sent", "sms_replied", "booked"]);
    assertChain(["sms_sent", "sms_replied", "exhausted"]);
    assertChain(["email_sent", "email_replied", "booked"]);
    assertChain(["email_sent", "email_replied", "exhausted"]);
  });

  it("re-enrollment: exhausted → re_enrolled → call_initiated", () => {
    assertChain(["exhausted", "re_enrolled", "call_initiated"]);
  });

  it("opt-out mid-sequence can exhaust from active states", () => {
    for (const s of [
      "pending",
      "call_initiated",
      "call_connected",
      "call_busy",
      "sms_sent",
      "email_sent",
    ] as EnrollmentStatus[]) {
      assert.equal(
        stateMachine.canTransition(s, "exhausted"),
        true,
        `${s} → exhausted should be allowed for opt-out`
      );
    }
  });

  it("terminal states have no outbound transitions (except exhausted → re_enrolled)", () => {
    assert.deepEqual(TRANSITIONS.booked, []);
    assert.deepEqual(TRANSITIONS.exhausted, ["re_enrolled"]);
    assert.ok(TERMINAL_STATUSES.includes("booked"));
    assert.ok(TERMINAL_STATUSES.includes("exhausted"));
  });

  it("SMS_READY_STATUSES are exactly the pre-SMS call outcomes", () => {
    assert.deepEqual(
      [...SMS_READY_STATUSES].sort(),
      ["call_busy", "call_failed", "call_no_answer"].sort()
    );
  });
});

// ─── 2. Busy retry decisions ──────────────────────────────────────────────────

describe("M1 busy retry — shouldRetryBusyCall", () => {
  it("retries while attempts < 3", () => {
    assert.equal(shouldRetryBusyCall(1), true);  // after 1st dial
    assert.equal(shouldRetryBusyCall(2), true);  // after 2nd dial (1st retry done)
  });

  it("stops retrying at attempt 3 (max 2 retries)", () => {
    assert.equal(shouldRetryBusyCall(3), false);
    assert.equal(shouldRetryBusyCall(4), false);
  });

  it("full busy sequence uses legal transitions at every step", () => {
    // Dial 1 busy
    assertChain(["pending", "call_initiated", "call_busy"]);
    // Retry dial 2
    assertChain(["call_busy", "call_initiated", "call_busy"]);
    // Retry dial 3 then fall to SMS
    assertChain(["call_busy", "call_initiated", "call_busy", "sms_sent"]);
  });
});

// ─── 3. Minute-limit → SMS fall-through ───────────────────────────────────────

describe("M1 minute-limit → SMS fall-through", () => {
  it("detects limit reached at equality and above", () => {
    assert.equal(isMinuteLimitReached(1000, 1000), true);
    assert.equal(isMinuteLimitReached(1001, 1000), true);
    assert.equal(isMinuteLimitReached(999, 1000), false);
    assert.equal(isMinuteLimitReached(0, 1000), false);
  });

  it("from pending: advances call_initiated → call_no_answer then SMS", () => {
    const plan = planSmsFallthrough("pending");
    assert.equal(plan.kind, "advance");
    if (plan.kind === "advance") {
      assert.deepEqual(plan.steps, ["call_initiated", "call_no_answer"]);
    }
    assert.equal(assertFallthroughChainLegal("pending", plan), true);
  });

  it("from re_enrolled: same advance chain as pending", () => {
    const plan = planSmsFallthrough("re_enrolled");
    assert.equal(assertFallthroughChainLegal("re_enrolled", plan), true);
  });

  it("from call_initiated / call_connected: single step to call_no_answer", () => {
    for (const s of ["call_initiated", "call_connected"] as EnrollmentStatus[]) {
      const plan = planSmsFallthrough(s);
      assert.equal(plan.kind, "advance");
      if (plan.kind === "advance") assert.deepEqual(plan.steps, ["call_no_answer"]);
      assert.equal(assertFallthroughChainLegal(s, plan), true);
    }
  });

  it("from call_busy / call_failed / call_no_answer: already SMS-ready", () => {
    for (const s of SMS_READY_STATUSES) {
      const plan = planSmsFallthrough(s);
      assert.equal(plan.kind, "sms_ready", `${s} should be sms_ready`);
      assert.equal(stateMachine.canTransition(s, "sms_sent"), true);
    }
  });

  it("skips when already past the call step", () => {
    for (const s of [
      "sms_sent",
      "email_sent",
      "booked",
      "exhausted",
    ] as EnrollmentStatus[]) {
      const plan = planSmsFallthrough(s);
      assert.equal(plan.kind, "skip", `${s} should skip`);
    }
  });
});

// ─── 4. Stuck enrollment recovery ─────────────────────────────────────────────

describe("M1 stuck enrollment recovery plans", () => {
  it("pending / re_enrolled: re-queue INITIATE_CALL with NO pre-transition", () => {
    for (const s of ["pending", "re_enrolled"] as EnrollmentStatus[]) {
      const plan = planStuckRecovery(s, 0);
      assert.equal(plan.action, "requeued_initiate_call");
      assert.deepEqual(plan.transitions, []); // critical: do not pre-mark call_initiated
      assert.equal(plan.enqueue, "INITIATE_CALL");
      assert.equal(assertRecoveryChainLegal(s, plan), true);
    }
  });

  it("call_initiated / call_connected: → call_no_answer + SEND_SMS", () => {
    for (const s of ["call_initiated", "call_connected"] as EnrollmentStatus[]) {
      const plan = planStuckRecovery(s, 1);
      assert.equal(plan.action, "call_no_answer_then_sms");
      assert.deepEqual(plan.transitions, ["call_no_answer"]);
      assert.equal(plan.enqueue, "SEND_SMS");
      assert.equal(assertRecoveryChainLegal(s, plan), true);
    }
  });

  it("call_busy under max attempts: re-queue busy retry", () => {
    const plan = planStuckRecovery("call_busy", 1);
    assert.equal(plan.action, "requeued_busy_retry");
    assert.equal(plan.enqueue, "INITIATE_CALL");
    assert.deepEqual(plan.transitions, []);
    assert.equal(assertRecoveryChainLegal("call_busy", plan), true);
  });

  it("call_busy at max attempts: fall through to SMS", () => {
    const plan = planStuckRecovery("call_busy", 3);
    assert.equal(plan.action, "busy_fallthrough_sms");
    assert.equal(plan.enqueue, "SEND_SMS");
    assert.equal(assertRecoveryChainLegal("call_busy", plan), true);
  });

  it("call_no_answer / call_failed: re-queue lost SEND_SMS", () => {
    for (const s of ["call_no_answer", "call_failed"] as EnrollmentStatus[]) {
      const plan = planStuckRecovery(s, 1);
      assert.equal(plan.action, "requeued_send_sms");
      assert.equal(plan.enqueue, "SEND_SMS");
      assert.deepEqual(plan.transitions, []);
      assert.equal(assertRecoveryChainLegal(s, plan), true);
    }
  });

  it("sms_sent: re-queue SEND_EMAIL without pre-marking email_sent (regression)", () => {
    const plan = planStuckRecovery("sms_sent", 1);
    assert.equal(plan.action, "requeued_send_email");
    assert.equal(plan.enqueue, "SEND_EMAIL");
    assert.deepEqual(plan.transitions, []); // THE bug we fixed
    assert.equal(assertRecoveryChainLegal("sms_sent", plan), true);
  });

  it("email_sent: exhaust + schedule re-enroll", () => {
    const plan = planStuckRecovery("email_sent", 1);
    assert.equal(plan.action, "exhausted_with_reenroll");
    assert.deepEqual(plan.transitions, ["exhausted"]);
    assert.equal(plan.enqueue, null);
    assert.equal(plan.scheduleReenroll, true);
    assert.equal(assertRecoveryChainLegal("email_sent", plan), true);
  });

  it("terminal statuses are not recovered", () => {
    for (const s of ["booked", "exhausted"] as EnrollmentStatus[]) {
      const plan = planStuckRecovery(s, 0);
      assert.equal(plan.recovered, false);
      assert.equal(plan.action, "terminal_skip");
    }
  });
});

// ─── 5. Queue ownership invariants ────────────────────────────────────────────

describe("M1 queue ownership invariants", () => {
  it("SEND_EMAIL may only run from sms_sent (SMS_TIMEOUT must not pre-transition)", () => {
    assert.equal(stateMachine.canTransition("sms_sent", "email_sent"), true);
    // There is no sms_timeout status — timeout only enqueues SEND_EMAIL
    assert.equal("sms_timeout" in TRANSITIONS, false);
  });

  it("SEND_SMS may only complete from SMS_READY_STATUSES", () => {
    for (const s of SMS_READY_STATUSES) {
      assert.equal(stateMachine.canTransition(s, "sms_sent"), true);
    }
    // pending cannot jump straight to sms_sent
    assertIllegal("pending", "sms_sent");
    assertIllegal("call_initiated", "sms_sent");
  });

  it("booked path requires call_connected before call_answered", () => {
    assertIllegal("call_initiated", "call_answered");
    assertChain(["call_initiated", "call_connected", "call_answered", "booked"]);
  });
});
