/** Complimentary test-call time vs paid call minutes. Test calls bill by the second. */

import { getTierLimits, isUnlimited } from "./tiers.js";

/** Match the in-browser rehearsal session TTL. */
export const TEST_CALL_HARD_CAP_SECONDS = 20 * 60;

export function minutesToSeconds(minutes: number): number {
  if (!Number.isFinite(minutes)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.round(Number(minutes) * 60));
}

export function remainingSeconds(used: number, limit: number): number {
  if (isUnlimited(limit)) return Number.POSITIVE_INFINITY;
  return Math.max(0, limit - Math.max(0, used));
}

/** Connected duration billed for a test call — exact seconds, no round-up. */
export function billableTestSeconds(durationSeconds: number): number {
  return Math.max(0, Math.floor(Number(durationSeconds) || 0));
}

/** @deprecated Tests bill by the second; kept as seconds/60 for older callers. */
export function billableTestMinutes(durationSeconds: number): number {
  return billableTestSeconds(durationSeconds) / 60;
}

export function remainingMinutes(used: number, limit: number): number {
  if (isUnlimited(limit)) return Number.POSITIVE_INFINITY;
  return Math.max(0, limit - Math.max(0, used));
}

export function formatMmSs(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) return "Unlimited";
  const n = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export interface TestCreditSnapshot {
  /** Seconds of complimentary test time used this period. */
  testUsed: number;
  testUsedSeconds: number;
  /** Complimentary allowance in minutes (20 / 40 / 60 / 60). */
  testLimitMinutes: number;
  testLimitSeconds: number;
  testRemainingSeconds: number;
  /** Alias of testLimitSeconds for older UI. */
  testLimit: number;
  /** Alias of testRemainingSeconds for older UI. */
  testRemaining: number;
  paidUsed: number;
  paidLimit: number;
  paidRemaining: number;
  paidRemainingSeconds: number;
  pool: "free_test" | "paid" | "split" | "blocked";
  allowed: boolean;
  usingPaid: boolean;
  message: string;
}

export function snapshotTestCredits(opts: {
  tier: string;
  /** Complimentary test usage in seconds. */
  testUsed: number;
  paidUsed: number;
  paidLimit: number;
}): TestCreditSnapshot {
  const limits = getTierLimits(opts.tier);
  const testLimitMinutes = limits.monthlyTestMinuteLimit;
  const testLimitSeconds = minutesToSeconds(testLimitMinutes);
  const testUsedSeconds = Math.max(0, Math.floor(Number(opts.testUsed) || 0));
  const testRemainingSeconds = remainingSeconds(testUsedSeconds, testLimitSeconds);
  const paidRemaining = remainingMinutes(opts.paidUsed, opts.paidLimit);
  const paidRemainingSeconds = Number.isFinite(paidRemaining)
    ? Math.max(0, Math.floor(paidRemaining * 60))
    : Number.POSITIVE_INFINITY;
  const usingPaid = testRemainingSeconds <= 0 && paidRemainingSeconds > 0;
  const allowed = testRemainingSeconds > 0 || paidRemainingSeconds > 0;
  let pool: TestCreditSnapshot["pool"] = "free_test";
  if (!allowed) pool = "blocked";
  else if (testRemainingSeconds <= 0) pool = "paid";
  else pool = "free_test";

  let message = `${formatMmSs(testRemainingSeconds)} free test time left this period.`;
  if (pool === "paid") {
    message =
      "Free test time is used up. This rehearsal will consume your paid calling minutes, billed by the second.";
  } else if (pool === "blocked") {
    message = "No free test time or paid calling minutes left. Upgrade or wait for the next period.";
  }

  return {
    testUsed: testUsedSeconds,
    testUsedSeconds,
    testLimitMinutes,
    testLimitSeconds,
    testRemainingSeconds: Number.isFinite(testRemainingSeconds) ? testRemainingSeconds : testLimitSeconds,
    testLimit: testLimitSeconds,
    testRemaining: Number.isFinite(testRemainingSeconds) ? testRemainingSeconds : testLimitSeconds,
    paidUsed: opts.paidUsed,
    paidLimit: opts.paidLimit,
    paidRemaining: Number.isFinite(paidRemaining) ? paidRemaining : opts.paidLimit,
    paidRemainingSeconds: Number.isFinite(paidRemainingSeconds) ? paidRemainingSeconds : minutesToSeconds(opts.paidLimit),
    pool,
    allowed,
    usingPaid,
    message,
  };
}

export function decideTestCallStart(opts: {
  snapshot: TestCreditSnapshot;
  allowPaid: boolean;
}): {
  start: boolean;
  reason: "ok" | "blocked" | "declined_paid";
  message: string;
} {
  if (!opts.snapshot.allowed || opts.snapshot.pool === "blocked") {
    return {
      start: false,
      reason: "blocked",
      message: opts.snapshot.message,
    };
  }
  if (opts.snapshot.usingPaid && !opts.allowPaid) {
    return {
      start: false,
      reason: "declined_paid",
      message:
        "Free test time is used up. You declined using paid calling minutes, so the test did not start and no monthly call credits were consumed.",
    };
  }
  return { start: true, reason: "ok", message: opts.snapshot.message };
}

export function sessionBudgetSeconds(opts: {
  testRemaining?: number;
  paidRemaining?: number;
  testRemainingSeconds?: number;
  paidRemainingSeconds?: number;
  allowPaid: boolean;
  hardCapSeconds?: number;
}): {
  budgetSeconds: number;
  budgetMinutes: number;
  freeSeconds: number;
} {
  const cap = opts.hardCapSeconds ?? TEST_CALL_HARD_CAP_SECONDS;
  const free = Number.isFinite(opts.testRemainingSeconds ?? opts.testRemaining)
    ? Math.max(0, Math.floor(Number(opts.testRemainingSeconds ?? opts.testRemaining) || 0))
    : cap;
  const paidRaw = opts.paidRemainingSeconds ?? opts.paidRemaining;
  const paid = opts.allowPaid
    ? Number.isFinite(paidRaw)
      ? Math.max(0, Math.floor(Number(paidRaw) || 0))
      : cap
    : 0;
  const budgetSeconds = Math.min(free + paid, cap);
  return {
    budgetSeconds,
    budgetMinutes: budgetSeconds / 60,
    freeSeconds: Math.min(free, cap),
  };
}

export function testCallClock(elapsedSeconds: number, budgetSeconds: number): {
  elapsedSeconds: number;
  remainingSeconds: number;
  billedSeconds: number;
  billedMinutes: number;
  exhausted: boolean;
} {
  const elapsed = Math.max(0, Math.floor(Number(elapsedSeconds) || 0));
  const budget = Math.max(0, Math.floor(Number(budgetSeconds) || 0));
  const capped = Math.min(elapsed, budget);
  return {
    elapsedSeconds: elapsed,
    remainingSeconds: Math.max(0, budget - elapsed),
    billedSeconds: capped,
    billedMinutes: capped / 60,
    exhausted: budget <= 0 || elapsed >= budget,
  };
}

function fmtSeconds(n: number): string {
  if (n === 1) return "1 second";
  return `${n} seconds`;
}

export function planTestCreditConsume(opts: {
  /** Exact connected seconds to bill. */
  seconds?: number;
  /** @deprecated Use seconds. Treated as minutes if `seconds` is omitted. */
  minutes?: number;
  testUsed: number;
  testLimit: number;
  paidUsed: number;
  paidLimit: number;
  allowPaid?: boolean;
  capToAvailable?: boolean;
}): {
  allowed: boolean;
  testDelta: number;
  paidDelta: number;
  paidDeltaSeconds: number;
  pool: "free_test" | "paid" | "split" | "blocked" | "declined_paid";
  usingPaid: boolean;
  declinedPaid: boolean;
  message: string;
} {
  const need =
    opts.seconds != null
      ? billableTestSeconds(opts.seconds)
      : minutesToSeconds(opts.minutes || 0);
  const allowPaid = opts.allowPaid !== false;
  const capToAvailable = opts.capToAvailable !== false;
  if (need <= 0) {
    return {
      allowed: true,
      testDelta: 0,
      paidDelta: 0,
      paidDeltaSeconds: 0,
      pool: "free_test",
      usingPaid: false,
      declinedPaid: false,
      message: "No usage billed.",
    };
  }

  const testLeft = remainingSeconds(opts.testUsed, opts.testLimit);
  const paidLeftMin = remainingMinutes(opts.paidUsed, opts.paidLimit);
  const paidLeft = Number.isFinite(paidLeftMin) ? Math.floor(paidLeftMin * 60) : need;
  const finiteTest = Number.isFinite(testLeft) ? testLeft : need;
  const fromTest = Math.min(need, finiteTest);
  const stillNeed = need - fromTest;

  if (stillNeed > 0 && !allowPaid) {
    if (fromTest > 0) {
      return {
        allowed: true,
        testDelta: fromTest,
        paidDelta: 0,
        paidDeltaSeconds: 0,
        pool: "free_test",
        usingPaid: false,
        declinedPaid: true,
        message: `Used ${fmtSeconds(fromTest)} of remaining free test time only. Paid calling minutes were not used because you declined.`,
      };
    }
    return {
      allowed: false,
      testDelta: 0,
      paidDelta: 0,
      paidDeltaSeconds: 0,
      pool: "declined_paid",
      usingPaid: false,
      declinedPaid: true,
      message:
        "Free test time is used up. You declined using paid calling minutes, so nothing was billed and the test did not continue.",
    };
  }

  const finitePaid = Number.isFinite(paidLeft) ? paidLeft : stillNeed;
  const fromPaid = Math.min(stillNeed, finitePaid);

  if (fromTest + fromPaid < need) {
    if (capToAvailable && fromTest + fromPaid > 0) {
      const usingPaid = fromPaid > 0;
      const pool = fromTest > 0 && fromPaid > 0 ? "split" : fromPaid > 0 ? "paid" : "free_test";
      return {
        allowed: true,
        testDelta: fromTest,
        paidDelta: fromPaid / 60,
        paidDeltaSeconds: fromPaid,
        pool,
        usingPaid,
        declinedPaid: false,
        message: `Billed the ${fmtSeconds(fromTest + fromPaid)} still available. The rehearsal ended when time ran out.`,
      };
    }
    return {
      allowed: false,
      testDelta: 0,
      paidDelta: 0,
      paidDeltaSeconds: 0,
      pool: "blocked",
      usingPaid: false,
      declinedPaid: false,
      message: "Not enough test or paid time remaining for this rehearsal.",
    };
  }

  const usingPaid = fromPaid > 0;
  const pool = fromTest > 0 && fromPaid > 0 ? "split" : fromPaid > 0 ? "paid" : "free_test";
  let message = `Billed ${fmtSeconds(fromTest)} of free test time.`;
  if (pool === "paid") {
    message = `Free test time is gone. Billed ${fmtSeconds(fromPaid)} of paid calling time.`;
  } else if (pool === "split") {
    message = `Used the last ${fmtSeconds(fromTest)} of free test time, then ${fmtSeconds(fromPaid)} of paid calling time.`;
  }

  return {
    allowed: true,
    testDelta: fromTest,
    paidDelta: fromPaid / 60,
    paidDeltaSeconds: fromPaid,
    pool,
    usingPaid,
    declinedPaid: false,
    message,
  };
}
