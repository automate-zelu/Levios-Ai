/**
 * Adversarial Stripe hygiene + test email redirect.
 * Run: npx tsx --test tests/stripe-hygiene.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const {
  isStripeMissingResourceError,
} = await import("../lib/stripe-hygiene.js");

const {
  resolveEmailDelivery,
  DEFAULT_TEST_EMAIL_REDIRECT,
} = await import("../lib/email-delivery.js");

describe("stripe missing-resource detection", () => {
  it("matches No such customer / subscription / resource_missing", () => {
    assert.equal(
      isStripeMissingResourceError(new Error("No such customer: 'cus_dead'")),
      true
    );
    assert.equal(
      isStripeMissingResourceError(new Error("No such subscription: 'sub_dead'")),
      true
    );
    assert.equal(
      isStripeMissingResourceError({ code: "resource_missing", message: "gone" }),
      true
    );
    assert.equal(
      isStripeMissingResourceError(new Error("card_declined")),
      false
    );
  });
});

describe("billing routes clear stale Stripe ids", () => {
  const billingSrc = readFileSync(path.join(root, "routes/billing.ts"), "utf8");
  const hygieneSrc = readFileSync(path.join(root, "lib/stripe-hygiene.ts"), "utf8");

  it("exports ensureLiveStripeCustomerId + clearOrgStripeBillingIds", () => {
    assert.match(hygieneSrc, /export async function ensureLiveStripeCustomerId/);
    assert.match(hygieneSrc, /export async function clearOrgStripeBillingIds/);
    assert.match(hygieneSrc, /export async function stripeCustomerExists/);
  });

  it("checkout uses ensureLiveStripeCustomerId", () => {
    assert.match(billingSrc, /ensureLiveStripeCustomerId/);
    assert.match(billingSrc, /stale_stripe_customer/);
  });

  it("portal / cancel / resume / status clear on missing resource", () => {
    assert.match(billingSrc, /clearOrgStripeBillingIds/);
    assert.match(billingSrc, /isStripeMissingResourceError/);
    assert.match(billingSrc, /stale_stripe_subscription/);
    assert.match(billingSrc, /Activate monthly billing/);
  });
});

describe("test email delivery — only btwimawais@gmail.com", () => {
  const prev = {
    NODE_ENV: process.env.NODE_ENV,
    EMAIL_TEST_ALLOW_SEND: process.env.EMAIL_TEST_ALLOW_SEND,
    EMAIL_TEST_REDIRECT_TO: process.env.EMAIL_TEST_REDIRECT_TO,
    EMAIL_FORCE_TEST_REDIRECT: process.env.EMAIL_FORCE_TEST_REDIRECT,
  };

  function restore() {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  it("defaults redirect target to btwimawais@gmail.com", () => {
    assert.equal(DEFAULT_TEST_EMAIL_REDIRECT, "btwimawais@gmail.com");
  });

  it("NODE_ENV=test skips sends by default (no real mail)", () => {
    process.env.NODE_ENV = "test";
    delete process.env.EMAIL_TEST_ALLOW_SEND;
    delete process.env.EMAIL_FORCE_TEST_REDIRECT;
    const plan = resolveEmailDelivery(["victim@example.com", "other@corp.com"]);
    assert.equal(plan.skipped, true);
    assert.equal(plan.reason, "test_skip");
    assert.deepEqual(plan.recipients, []);
    restore();
  });

  it("when test send allowed, only redirects to btwimawais@gmail.com", () => {
    process.env.NODE_ENV = "test";
    process.env.EMAIL_TEST_ALLOW_SEND = "1";
    delete process.env.EMAIL_TEST_REDIRECT_TO;
    const plan = resolveEmailDelivery("victim@example.com");
    assert.equal(plan.skipped, false);
    assert.equal(plan.redirected, true);
    assert.deepEqual(plan.recipients, ["btwimawais@gmail.com"]);
    restore();
  });

  it("EMAIL_FORCE_TEST_REDIRECT rewrites all recipients to safe inbox", () => {
    process.env.NODE_ENV = "production";
    process.env.EMAIL_FORCE_TEST_REDIRECT = "1";
    delete process.env.EMAIL_TEST_REDIRECT_TO;
    const plan = resolveEmailDelivery(["a@x.com", "b@y.com"]);
    assert.equal(plan.redirected, true);
    assert.deepEqual(plan.recipients, ["btwimawais@gmail.com"]);
    restore();
  });

  it("normal production send keeps original recipients", () => {
    process.env.NODE_ENV = "production";
    delete process.env.EMAIL_FORCE_TEST_REDIRECT;
    delete process.env.EMAIL_TEST_ALLOW_SEND;
    const plan = resolveEmailDelivery("user@client.com");
    assert.equal(plan.redirected, false);
    assert.deepEqual(plan.recipients, ["user@client.com"]);
    restore();
  });

  it("resend.ts wires resolveEmailDelivery", () => {
    const src = readFileSync(path.join(root, "lib/resend.ts"), "utf8");
    assert.match(src, /resolveEmailDelivery/);
    assert.match(src, /email-delivery/);
  });
});

describe("adversarial ensureLiveStripeCustomerId", () => {
  it("creates customer when none stored (checkout recovery path)", async () => {
    const { ensureLiveStripeCustomerId } = await import("../lib/stripe-hygiene.js");
    const created = await ensureLiveStripeCustomerId({
      organizationId: 999999,
      email: "btwimawais@gmail.com",
      organizationName: "Adversarial Test Org",
      currentCustomerId: null,
      createCustomer: async (orgId, email) => {
        assert.equal(orgId, 999999);
        assert.equal(email, "btwimawais@gmail.com");
        return { id: "cus_test_new" };
      },
    });
    assert.equal(created.customerId, "cus_test_new");
    assert.equal(created.recreated, true);
  });

  it("throws when createCustomer fails", async () => {
    const { ensureLiveStripeCustomerId } = await import("../lib/stripe-hygiene.js");
    await assert.rejects(
      () =>
        ensureLiveStripeCustomerId({
          organizationId: 999998,
          email: "btwimawais@gmail.com",
          organizationName: "Fail Org",
          currentCustomerId: null,
          createCustomer: async () => null,
        }),
      /Failed to create Stripe customer/
    );
  });
});
