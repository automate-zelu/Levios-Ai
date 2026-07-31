/**
 * Pricing catalog — IMPLEMENTATION_PLAN §15 / §21.3
 * Run: npx tsx --test tests/pricing.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PLAN_PRICING,
  PAID_PLAN_ORDER,
  formatMonthlyPriceLabel,
  formatUsdFromCents,
  listPublicPlans,
  resolveStripePriceId,
  stripePriceEnvKey,
} from "../lib/pricing.js";

describe("pricing catalog (plan §15 / §21.3)", () => {
  it("defines four paid tiers in order", () => {
    assert.deepEqual(PAID_PLAN_ORDER, ["starter", "growth", "scale", "enterprise"]);
  });

  it("uses low-end suggested band as default Stripe list prices", () => {
    assert.equal(PLAN_PRICING.starter.monthlyPriceCents, 29_700);
    assert.equal(PLAN_PRICING.growth.monthlyPriceCents, 79_700);
    assert.equal(PLAN_PRICING.scale.monthlyPriceCents, 149_700);
    assert.equal(PLAN_PRICING.enterprise.monthlyPriceCents, 249_700);
  });

  it("keeps suggested price bands from the plan", () => {
    assert.equal(PLAN_PRICING.starter.suggestedMinUsd, 297);
    assert.equal(PLAN_PRICING.starter.suggestedMaxUsd, 497);
    assert.equal(PLAN_PRICING.enterprise.suggestedMinUsd, 2497);
    assert.equal(PLAN_PRICING.enterprise.suggestedMaxUsd, 3497);
  });

  it("matches tier lead limits", () => {
    assert.equal(PLAN_PRICING.starter.leadsPerMonth, 500);
    assert.equal(PLAN_PRICING.growth.leadsPerMonth, 2000);
    assert.equal(PLAN_PRICING.scale.leadsPerMonth, 5000);
  });

  it("formats USD labels", () => {
    assert.equal(formatUsdFromCents(29_700), "$297");
    assert.equal(formatMonthlyPriceLabel(79_700), "$797 / mo");
  });

  it("lists public plans without exposing raw price IDs", () => {
    const plans = listPublicPlans();
    assert.equal(plans[0].key, "free");
    const starter = plans.find((p) => p.key === "starter");
    assert.ok(starter);
    assert.equal(starter.monthlyPriceLabel, "$297 / mo");
    assert.ok(starter.priceId === null || starter.priceId === "configured");
  });

  it("resolves Stripe env keys", () => {
    assert.equal(stripePriceEnvKey("growth"), "STRIPE_GROWTH_PRICE_ID");
    const prev = process.env.STRIPE_STARTER_PRICE_ID;
    process.env.STRIPE_STARTER_PRICE_ID = "price_test_123";
    try {
      assert.equal(resolveStripePriceId("starter"), "price_test_123");
    } finally {
      if (prev === undefined) delete process.env.STRIPE_STARTER_PRICE_ID;
      else process.env.STRIPE_STARTER_PRICE_ID = prev;
    }
  });
});
