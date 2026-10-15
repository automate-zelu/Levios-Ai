/**
 * P1 — Billing & pricing (retainer SoT, hybrid preview, pause, asterisk).
 * Run: npx tsx --test tests/p1-billing.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const {
  DEFAULT_GLOBAL_MONTHLY_FEE_CENTS,
  MARKETING_PLAN_BY_KEY,
  marketingNameForPlan,
  PER_APPOINTMENT_FOOTNOTE,
  PER_APPOINTMENT_ASTERISK,
  validateFeeCents,
  MONTHLY_FEE_MIN_CENTS,
  MONTHLY_FEE_MAX_CENTS,
  buildHybridInvoicePreview,
  resolveCommercialPricing,
  planMonthlyCharge,
} = await import("../lib/commercial-pricing.js");

const { PLAN_PRICING, listPublicPlans } = await import("../lib/pricing.js");
const { TIER_LIMITS } = await import("../lib/tiers.js");
const {
  shouldAutoPauseOnPaymentFailure,
  isOutboundBlockedByPause,
  SERVICE_PAUSED_BANNER,
  isBillingCadence,
} = await import("../lib/billing-pause.js");
const {
  USAGE_METERING_MATRIX,
  listBillableMeters,
  usageLinesForInvoicePreview,
} = await import("../lib/usage-billing.js");
const { evaluateEnrollmentEligibility } = await import("../lib/sdr-eligibility.js");

describe("P1.1 — $297 single source of truth + marketing map", () => {
  it("DEFAULT_GLOBAL_MONTHLY_FEE_CENTS is $297", () => {
    assert.equal(DEFAULT_GLOBAL_MONTHLY_FEE_CENTS, 29_700);
  });

  it("Starter / Ignite list price imports the commercial constant", () => {
    assert.equal(PLAN_PRICING.starter.monthlyPriceCents, DEFAULT_GLOBAL_MONTHLY_FEE_CENTS);
    assert.equal(marketingNameForPlan("starter"), "Ignite");
    assert.equal(MARKETING_PLAN_BY_KEY.growth, "Catalyze");
    assert.equal(MARKETING_PLAN_BY_KEY.scale, "Chain Reaction");
    assert.equal(TIER_LIMITS.starter.marketingName, "Ignite");
    assert.equal(listPublicPlans().find((p) => p.key === "starter")?.marketingName, "Ignite");
  });

  it("documents $297 in commercial-pricing.ts header", () => {
    const src = readFileSync(path.join(root, "lib/commercial-pricing.ts"), "utf8");
    assert.match(src, /Where does \$297 come from/);
    assert.match(src, /DEFAULT_GLOBAL_MONTHLY_FEE_CENTS/);
    assert.match(src, /Ignite/);
  });
});

describe("P1.2 — fee validation bounds", () => {
  it("accepts in-range monthly fees and rejects out-of-range", () => {
    assert.equal(
      validateFeeCents(29_700, {
        min: MONTHLY_FEE_MIN_CENTS,
        max: MONTHLY_FEE_MAX_CENTS,
        label: "Monthly retainer",
      }),
      29_700
    );
    assert.throws(
      () =>
        validateFeeCents(-1, {
          min: MONTHLY_FEE_MIN_CENTS,
          max: MONTHLY_FEE_MAX_CENTS,
          label: "Monthly retainer",
        }),
      /Monthly retainer/
    );
    assert.throws(
      () =>
        validateFeeCents(MONTHLY_FEE_MAX_CENTS + 1, {
          min: MONTHLY_FEE_MIN_CENTS,
          max: MONTHLY_FEE_MAX_CENTS,
          label: "Monthly retainer",
        }),
      /Monthly retainer/
    );
  });

  it("admin route patches cadence / pause fields and logs actor", () => {
    const admin = readFileSync(path.join(root, "routes/admin.ts"), "utf8");
    assert.match(admin, /billingCadence/);
    assert.match(admin, /pauseExempt/);
    assert.match(admin, /paymentPlanApproved/);
    assert.match(admin, /actorUserId|actorLabel/);
  });
});

describe("P1.3 — hybrid metering + invoice preview", () => {
  it("defines metering matrix with appointment billable and minutes included", () => {
    assert.ok(USAGE_METERING_MATRIX.length >= 4);
    assert.equal(listBillableMeters().every((m) => m.billable), true);
    assert.ok(listBillableMeters().some((m) => m.id === "appointment_booked"));
    assert.ok(USAGE_METERING_MATRIX.some((m) => m.id === "call_minutes" && m.includedInRetainer));
  });

  it("zero-usage month still charges retainer only", () => {
    const platform = {
      monthlyFeeCents: DEFAULT_GLOBAL_MONTHLY_FEE_CENTS,
      monthlyFeeEnabledByDefault: true,
      defaultAppointmentFeeCents: 0,
    };
    const pricing = resolveCommercialPricing(platform, {
      monthlyFeeEnabled: true,
      monthlyFeeOverrideCents: null,
      appointmentFeeEnabled: true,
      costPerAppointmentCents: 40_000,
    });
    const preview = buildHybridInvoicePreview({
      pricing,
      appointmentCount: 0,
      extraUsageLines: usageLinesForInvoicePreview({ appointmentCount: 0, callMinutesUsed: 0 }),
    });
    assert.equal(preview.retainerCents, 29_700);
    assert.equal(preview.usageCents, 0);
    assert.equal(preview.totalCents, 29_700);
    assert.deepEqual(planMonthlyCharge(pricing), {
      amountCents: 29_700,
      feeKind: "monthly",
    });
  });

  it("hybrid preview adds appointment usage and included minute lines", () => {
    const pricing = resolveCommercialPricing(
      {
        monthlyFeeCents: DEFAULT_GLOBAL_MONTHLY_FEE_CENTS,
        monthlyFeeEnabledByDefault: true,
        defaultAppointmentFeeCents: 0,
      },
      {
        monthlyFeeEnabled: true,
        monthlyFeeOverrideCents: 49_700,
        appointmentFeeEnabled: true,
        costPerAppointmentCents: 40_000,
      }
    );
    const preview = buildHybridInvoicePreview({
      pricing,
      appointmentCount: 2,
      extraUsageLines: usageLinesForInvoicePreview({
        appointmentCount: 2,
        callMinutesUsed: 120,
      }),
    });
    assert.equal(preview.retainerCents, 49_700);
    assert.equal(preview.usageCents, 80_000);
    assert.equal(preview.totalCents, 129_700);
    assert.ok(preview.lines.some((l) => l.label.includes("Per appointment")));
    assert.ok(preview.lines.some((l) => l.includedInRetainer && l.label.includes("minutes")));
  });
});

describe("P1.4 — non-payment pause", () => {
  it("skips auto-pause when exempt or payment plan approved", () => {
    assert.equal(shouldAutoPauseOnPaymentFailure({ pauseExempt: true }), false);
    assert.equal(shouldAutoPauseOnPaymentFailure({ paymentPlanApproved: true }), false);
    assert.equal(shouldAutoPauseOnPaymentFailure({}), true);
  });

  it("blocks outbound when servicePaused", () => {
    assert.equal(isOutboundBlockedByPause({ servicePaused: true }), true);
    assert.equal(isOutboundBlockedByPause({ servicePaused: false }), false);
    assert.match(SERVICE_PAUSED_BANNER, /Service paused/);
    assert.equal(isBillingCadence("weekly"), true);
    assert.equal(isBillingCadence("daily"), false);
  });

  it("enrollment eligibility denies when servicePaused", () => {
    const d = evaluateEnrollmentEligibility({
      lead: { status: "new", consentStatus: "opted_in", dncClean: true },
      workspace: { isActive: true, servicePaused: true },
      requireDormant: false,
    });
    assert.equal(d.ok, false);
    if (!d.ok) assert.equal(d.reason, "service_paused");
  });

  it("wires stripe + schema + banner", () => {
    const stripe = readFileSync(path.join(root, "lib/stripe.ts"), "utf8");
    assert.match(stripe, /pauseOrgForNonPayment/);
    assert.match(stripe, /resumeOrgAfterPayment/);
    const schema = readFileSync(path.join(root, "lib/schema.ts"), "utf8");
    assert.match(schema, /servicePaused|service_paused/);
    assert.match(schema, /billingCadence|billing_cadence/);
    assert.match(schema, /pauseExempt|pause_exempt/);
    assert.match(schema, /usage_events|usageEvents/);
    const app = readFileSync(path.join(root, "client/src/App.jsx"), "utf8");
    assert.match(app, /Service paused — update payment/);
    const billing = readFileSync(path.join(root, "client/src/pages/BillingPage.jsx"), "utf8");
    assert.match(billing, /servicePause/);
  });
});

describe("P1.5 — pricing asterisk / legal copy", () => {
  it("exports footnote constant", () => {
    assert.equal(PER_APPOINTMENT_ASTERISK, "*");
    assert.match(PER_APPOINTMENT_FOOTNOTE, /Leviosa Labs/);
    assert.match(PER_APPOINTMENT_FOOTNOTE, /weekly or monthly/);
  });

  it("surfaces asterisk on Billing + admin UIs", () => {
    const billing = readFileSync(path.join(root, "client/src/pages/BillingPage.jsx"), "utf8");
    assert.match(billing, /Per appointment\*/);
    assert.match(billing, /pricingFootnote|Leviosa Labs/);
    const detail = readFileSync(
      path.join(root, "client/src/components/admin/WorkspaceDetail.jsx"),
      "utf8"
    );
    assert.match(detail, /Per-appointment\*/);
    assert.match(detail, /Leviosa Labs/);
    const pricingUi = readFileSync(
      path.join(root, "client/src/components/admin/CommercialPricingSettings.jsx"),
      "utf8"
    );
    assert.match(pricingUi, /Per appointment\*/);
  });

  it("ships helper modules", () => {
    assert.ok(existsSync(path.join(root, "lib/billing-pause.ts")));
    assert.ok(existsSync(path.join(root, "lib/usage-billing.ts")));
  });
});
