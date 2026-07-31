/**
 * Module 7 — Reactor re-enroll validation + tier-limit skip helpers
 * Run: npx tsx --test tests/m7-reenroll.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isReenrollGateOpen,
  computeNextEnrollAfter,
  isLeadDormant,
  shouldSkipWorkspaceForLeadLimit,
  wouldExceedLeadLimitAfter,
  evaluateEnrollmentEligibility,
  SKIP_LEAD_STATUSES,
  ACTIVE_ENROLLMENT_STATUSES,
} from "../lib/sdr-eligibility.js";
import { UNLIMITED } from "../lib/tiers.js";

const now = new Date("2026-07-30T12:00:00.000Z");

describe("M7 re-enroll gate", () => {
  it("opens when nextEnrollAfter is null or past", () => {
    assert.equal(isReenrollGateOpen(null, now), true);
    assert.equal(isReenrollGateOpen(undefined, now), true);
    assert.equal(isReenrollGateOpen(new Date("2026-07-01T00:00:00.000Z"), now), true);
  });

  it("blocks when nextEnrollAfter is still in the future", () => {
    assert.equal(isReenrollGateOpen(new Date("2026-08-30T00:00:00.000Z"), now), false);
  });

  it("computeNextEnrollAfter adds reEnrollDays", () => {
    const at = computeNextEnrollAfter(30, now);
    assert.equal(at.toISOString(), "2026-08-29T12:00:00.000Z");
  });
});

describe("M7 dormancy", () => {
  it("treats never-contacted leads as dormant", () => {
    assert.equal(isLeadDormant(null, 7, now), true);
  });

  it("requires last contact before cutoff", () => {
    assert.equal(isLeadDormant(new Date("2026-07-20T12:00:00.000Z"), 7, now), true);
    assert.equal(isLeadDormant(new Date("2026-07-28T12:00:00.000Z"), 7, now), false);
  });
});

describe("M7 tier-limit skip", () => {
  it("skips workspace when used >= limit", () => {
    assert.equal(shouldSkipWorkspaceForLeadLimit(100, 100), true);
    assert.equal(shouldSkipWorkspaceForLeadLimit(99, 100), false);
    assert.equal(shouldSkipWorkspaceForLeadLimit(999_999, UNLIMITED), false);
  });

  it("mid-scan uses per-workspace enrolled count (not global)", () => {
    // Used 98, limit 100, already enrolled 2 this scan → next would hit limit
    assert.equal(wouldExceedLeadLimitAfter(98, 100, 2), true);
    assert.equal(wouldExceedLeadLimitAfter(98, 100, 1), false);
    // Regression: global totalEnrolled of 50 must NOT poison a fresh workspace
    assert.equal(wouldExceedLeadLimitAfter(0, 100, 0), false);
  });
});

describe("M7 evaluateEnrollmentEligibility", () => {
  const openWs = {
    isActive: true,
    monthlyLeadsUsed: 10,
    monthlyLeadLimit: 100,
  };

  it("allows fresh enrollment with no prior row", () => {
    const d = evaluateEnrollmentEligibility({
      lead: { status: "new", lastContactedAt: null },
      latestEnrollment: null,
      workspace: openWs,
      dormantDays: 7,
      now,
    });
    assert.deepEqual(d, { ok: true, mode: "fresh" });
  });

  it("blocks active sequences including re_enrolled", () => {
    for (const status of ["pending", "sms_sent", "re_enrolled"] as const) {
      const d = evaluateEnrollmentEligibility({
        lead: { status: "new", lastContactedAt: null },
        latestEnrollment: { id: "e1", status, nextEnrollAfter: null },
        workspace: openWs,
        requireDormant: false,
        now,
      });
      assert.equal(d.ok, false);
      if (!d.ok) assert.equal(d.reason, "active_enrollment");
    }
  });

  it("never re-enrolls booked leads", () => {
    const d = evaluateEnrollmentEligibility({
      lead: { status: "qualified", lastContactedAt: null },
      latestEnrollment: { id: "e1", status: "booked", nextEnrollAfter: null },
      workspace: openWs,
      requireDormant: false,
      now,
    });
    assert.equal(d.ok, false);
    if (!d.ok) assert.equal(d.reason, "booked");
  });

  it("respects re_enroll_days gate on exhausted", () => {
    const blocked = evaluateEnrollmentEligibility({
      lead: { status: "contacted", lastContactedAt: null },
      latestEnrollment: {
        id: "e1",
        status: "exhausted",
        nextEnrollAfter: new Date("2026-08-15T00:00:00.000Z"),
      },
      workspace: openWs,
      requireDormant: false,
      now,
    });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.reason, "reenroll_gate");

    const open = evaluateEnrollmentEligibility({
      lead: { status: "contacted", lastContactedAt: null },
      latestEnrollment: {
        id: "e1",
        status: "exhausted",
        nextEnrollAfter: new Date("2026-07-01T00:00:00.000Z"),
      },
      workspace: openWs,
      requireDormant: false,
      now,
    });
    assert.deepEqual(open, { ok: true, mode: "reenroll", enrollmentId: "e1" });
  });

  it("blocks won/lost, opted_out, dnc, inactive workspace, lead limit", () => {
    assert.equal(
      evaluateEnrollmentEligibility({
        lead: { status: "won" },
        requireDormant: false,
        now,
      }).ok,
      false
    );
    assert.equal(
      evaluateEnrollmentEligibility({
        lead: { status: "new", consentStatus: "opted_out" },
        requireDormant: false,
        now,
      }).ok,
      false
    );
    assert.equal(
      evaluateEnrollmentEligibility({
        lead: { status: "new", dncClean: false },
        requireDormant: false,
        now,
      }).ok,
      false
    );
    assert.equal(
      evaluateEnrollmentEligibility({
        lead: { status: "new" },
        workspace: { isActive: false, monthlyLeadsUsed: 0, monthlyLeadLimit: 100 },
        requireDormant: false,
        now,
      }).ok,
      false
    );
    assert.equal(
      evaluateEnrollmentEligibility({
        lead: { status: "new" },
        workspace: { isActive: true, monthlyLeadsUsed: 100, monthlyLeadLimit: 100 },
        requireDormant: false,
        now,
      }).ok,
      false
    );
  });

  it("exports skip/active constants used by the scanner", () => {
    assert.ok(SKIP_LEAD_STATUSES.includes("won"));
    assert.ok(ACTIVE_ENROLLMENT_STATUSES.includes("re_enrolled"));
    assert.ok(!ACTIVE_ENROLLMENT_STATUSES.includes("exhausted"));
    assert.ok(!ACTIVE_ENROLLMENT_STATUSES.includes("booked"));
  });
});
