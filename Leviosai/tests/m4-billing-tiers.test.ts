/**
 * Module 4 — Billing & Tier Enforcement
 * Run: npx tsx --test tests/m4-billing-tiers.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TIER_LIMITS,
  UNLIMITED,
  getTierLimits,
  isSdrTier,
  planKeyToSdrTier,
  isLeadLimitReached,
  isMinuteLimitReached,
  isSeatLimitReached,
  canInviteSeat,
  SDR_TIERS,
} from "../lib/tiers.js";

describe("M4 tier definitions (plan §15.1)", () => {
  it("defines starter / growth / scale / enterprise", () => {
    assert.deepEqual([...SDR_TIERS].sort(), ["enterprise", "growth", "scale", "starter"]);
  });

  it("matches plan lead / minute / seat limits", () => {
    assert.equal(TIER_LIMITS.starter.monthlyLeadLimit, 500);
    assert.equal(TIER_LIMITS.starter.monthlyMinuteLimit, 1_000);
    assert.equal(TIER_LIMITS.starter.seatLimit, 2);

    assert.equal(TIER_LIMITS.growth.monthlyLeadLimit, 2_000);
    assert.equal(TIER_LIMITS.growth.monthlyMinuteLimit, 4_000);
    assert.equal(TIER_LIMITS.growth.seatLimit, 5);

    assert.equal(TIER_LIMITS.scale.monthlyLeadLimit, 5_000);
    assert.equal(TIER_LIMITS.scale.monthlyMinuteLimit, 10_000);
    assert.equal(TIER_LIMITS.scale.seatLimit, 15);

    assert.equal(TIER_LIMITS.enterprise.monthlyLeadLimit, UNLIMITED);
    assert.equal(TIER_LIMITS.enterprise.monthlyMinuteLimit, UNLIMITED);
    assert.equal(TIER_LIMITS.enterprise.seatLimit, UNLIMITED);
  });

  it("isSdrTier / getTierLimits fall back safely", () => {
    assert.equal(isSdrTier("scale"), true);
    assert.equal(isSdrTier("pro"), false);
    assert.equal(getTierLimits("unknown").label, "Starter");
  });
});

describe("M4 Stripe plan → SDR tier mapping", () => {
  it("maps free/pro aliases and named tiers", () => {
    assert.equal(planKeyToSdrTier("free"), "starter");
    assert.equal(planKeyToSdrTier("starter"), "starter");
    assert.equal(planKeyToSdrTier("pro"), "growth");
    assert.equal(planKeyToSdrTier("growth"), "growth");
    assert.equal(planKeyToSdrTier("scale"), "scale");
    assert.equal(planKeyToSdrTier("enterprise"), "enterprise");
  });
});

describe("M4 limit enforcement helpers", () => {
  it("lead limit: equality blocks, unlimited never blocks", () => {
    assert.equal(isLeadLimitReached(500, 500), true);
    assert.equal(isLeadLimitReached(499, 500), false);
    assert.equal(isLeadLimitReached(50_000, UNLIMITED), false);
  });

  it("minute limit: equality blocks, unlimited never blocks", () => {
    assert.equal(isMinuteLimitReached(1000, 1000), true);
    assert.equal(isMinuteLimitReached(0, 1000), false);
    assert.equal(isMinuteLimitReached(999_999, UNLIMITED), false);
  });

  it("seat invite gate (plan §5)", () => {
    assert.equal(isSeatLimitReached(2, 2), true);
    assert.equal(isSeatLimitReached(1, 2), false);
    assert.equal(canInviteSeat(2, 2).allowed, false);
    assert.equal(canInviteSeat(1, 2).allowed, true);
    assert.equal(canInviteSeat(100, UNLIMITED).allowed, true);
    assert.match(canInviteSeat(5, 5).reason || "", /Seat limit reached/);
  });
});
