/**
 * Per-user subscription billing dates and auto-charge rules.
 * Run: npx tsx --test tests/subscription-billing.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addCalendarMonthsUtc,
  computeNextBillingAt,
  cyclePeriodKey,
  shouldChargeAppointment,
  shouldChargeMonthly,
  utcYmd,
} from "../lib/subscription-cycle.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("subscription cycle dates", () => {
  it("keeps the same day-of-month across months", () => {
    const anchor = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
    const next = addCalendarMonthsUtc(anchor, 1);
    assert.equal(utcYmd(next), "2026-02-15");
    assert.equal(utcYmd(addCalendarMonthsUtc(anchor, 2)), "2026-03-15");
  });

  it("clamps month-end (Jan 31 → Feb 28)", () => {
    const anchor = new Date(Date.UTC(2026, 0, 31, 9, 0, 0));
    assert.equal(utcYmd(addCalendarMonthsUtc(anchor, 1)), "2026-02-28");
    assert.equal(utcYmd(addCalendarMonthsUtc(anchor, 2)), "2026-03-31");
  });

  it("computes the next anniversary after a given instant", () => {
    const anchor = new Date(Date.UTC(2026, 8, 3, 10, 0, 0));
    const afterFirst = new Date(Date.UTC(2026, 8, 3, 10, 0, 1));
    assert.equal(utcYmd(computeNextBillingAt(anchor, afterFirst)), "2026-10-03");
    assert.equal(cyclePeriodKey(anchor), "2026-09-03");
  });
});

describe("shouldChargeMonthly", () => {
  const now = new Date(Date.UTC(2026, 9, 3, 12, 0, 0));
  const due = new Date(Date.UTC(2026, 9, 3, 10, 0, 0));
  const future = new Date(Date.UTC(2026, 9, 15, 10, 0, 0));

  it("charges when the org's own nextBillingAt is due", () => {
    assert.deepEqual(
      shouldChargeMonthly({
        now,
        nextBillingAt: due,
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
        subscriptionCanceledAt: null,
      }),
      { due: true, reason: "due" }
    );
  });

  it("does not charge after the user cancels", () => {
    assert.equal(
      shouldChargeMonthly({
        now,
        nextBillingAt: due,
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
        subscriptionCanceledAt: new Date(Date.UTC(2026, 8, 20)),
      }).reason,
      "canceled"
    );
  });

  it("does not charge before that user's billing date", () => {
    assert.equal(
      shouldChargeMonthly({
        now,
        nextBillingAt: future,
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
        subscriptionCanceledAt: null,
      }).reason,
      "not_due"
    );
  });

  it("skips orgs without a saved card or subscription", () => {
    assert.equal(
      shouldChargeMonthly({
        now,
        nextBillingAt: due,
        stripeCustomerId: null,
        stripeSubscriptionId: "sub_1",
        subscriptionCanceledAt: null,
      }).reason,
      "no_card"
    );
    assert.equal(
      shouldChargeMonthly({
        now,
        nextBillingAt: due,
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: null,
        subscriptionCanceledAt: null,
      }).reason,
      "no_subscription"
    );
  });
});

describe("shouldChargeAppointment", () => {
  it("still charges booking fees after the monthly subscription is canceled", () => {
    assert.deepEqual(
      shouldChargeAppointment({
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
        subscriptionCanceledAt: new Date(Date.UTC(2026, 8, 20)),
      }),
      { due: true, reason: "appointment_fee" }
    );
  });

  it("still charges booking fees after the Stripe subscription is removed", () => {
    assert.deepEqual(
      shouldChargeAppointment({
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: null,
        subscriptionCanceledAt: new Date(),
      }),
      { due: true, reason: "appointment_fee" }
    );
  });

  it("needs a saved card", () => {
    assert.equal(
      shouldChargeAppointment({
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        subscriptionCanceledAt: new Date(),
      }).reason,
      "no_card"
    );
  });
});

describe("automatic billing wiring", () => {
  it("runs a per-user cron, charges cards, and lets users cancel", () => {
    const server = readFileSync(path.join(root, "server.ts"), "utf8");
    assert.match(server, /startSubscriptionBillingCron/);

    const billing = readFileSync(path.join(root, "lib/subscription-billing.ts"), "utf8");
    assert.match(billing, /runDueMonthlyCharges|runPendingAppointmentCharges/);
    assert.match(billing, /chargeCustomerOffSession/);
    assert.match(billing, /collectChargeFromCard/);
    assert.match(billing, /shouldChargeAppointment/);
    assert.match(billing, /feeKind === "monthly" && org.subscriptionCanceledAt/);

    const stripe = readFileSync(path.join(root, "lib/stripe.ts"), "utf8");
    assert.match(stripe, /pauseSubscriptionCollection|pause_collection/);
    assert.match(stripe, /off_session:\s*true/);
    assert.match(stripe, /payment_intent\.succeeded/);
    assert.match(stripe, /unit_amount:\s*amount/);

    const routes = readFileSync(path.join(root, "routes/billing.ts"), "utf8");
    assert.match(routes, /billingCycle/);
    assert.match(routes, /subscriptionCanceledAt/);
    assert.match(routes, /Appointment booking fees are still charged/);

    const service = readFileSync(path.join(root, "lib/commercial-pricing-service.ts"), "utf8");
    assert.match(service, /collectChargeFromCard/);
    assert.match(service, /does not skip this charge|still billed/i);

    const page = readFileSync(path.join(root, "client/src/pages/BillingPage.jsx"), "utf8");
    assert.match(page, /Cancel subscription/);
    assert.match(page, /Appointment bookings are still charged|still be charged to your card/);
    assert.doesNotMatch(page, /card will not be charged again/);

    assert.ok(existsSync(path.join(root, "lib/subscription-cycle.ts")));
    assert.ok(existsSync(path.join(root, "lib/subscription-billing.ts")));
  });
});
