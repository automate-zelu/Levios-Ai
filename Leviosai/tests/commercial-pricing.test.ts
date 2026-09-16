/**
 * Hybrid commercial pricing: global monthly fee + per-org appointment fee.
 * Run: npx tsx --test tests/commercial-pricing.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_APPOINTMENT_FEE_CENTS,
  DEFAULT_GLOBAL_MONTHLY_FEE_CENTS,
  formatUsdFromCents,
  parseUsdToCents,
  planAppointmentCharge,
  planMonthlyCharge,
  resolveCommercialPricing,
} from "../lib/commercial-pricing.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const platform = {
  monthlyFeeCents: DEFAULT_GLOBAL_MONTHLY_FEE_CENTS,
  monthlyFeeEnabledByDefault: true,
  defaultAppointmentFeeCents: DEFAULT_APPOINTMENT_FEE_CENTS,
};

describe("resolveCommercialPricing", () => {
  it("uses global monthly amount when org has no override", () => {
    const resolved = resolveCommercialPricing(platform, {
      monthlyFeeEnabled: null,
      monthlyFeeOverrideCents: null,
      appointmentFeeEnabled: null,
      costPerAppointmentCents: null,
    });
    assert.equal(resolved.monthlyFeeEnabled, true);
    assert.equal(resolved.monthlyFeeCents, 29_700);
    assert.equal(resolved.monthlyUsesGlobalAmount, true);
    assert.equal(resolved.appointmentFeeEnabled, false);
    assert.equal(resolved.appointmentFeeCents, 0);
    assert.equal(planAppointmentCharge(resolved), null);
  });

  it("charges appointment fee only after admin enables it for the client", () => {
    const resolved = resolveCommercialPricing(platform, {
      monthlyFeeEnabled: null,
      monthlyFeeOverrideCents: null,
      appointmentFeeEnabled: true,
      costPerAppointmentCents: 40_000,
    });
    assert.equal(resolved.appointmentFeeEnabled, true);
    assert.equal(resolved.appointmentFeeCents, 40_000);
    assert.deepEqual(planAppointmentCharge(resolved), {
      amountCents: 40_000,
      feeKind: "appointment",
    });
  });

  it("never turns monthly retainer off — appointment fee can still be negotiated", () => {
    const resolved = resolveCommercialPricing(platform, {
      monthlyFeeEnabled: false,
      monthlyFeeOverrideCents: null,
      appointmentFeeEnabled: true,
      costPerAppointmentCents: 50_000,
    });
    assert.equal(resolved.monthlyFeeEnabled, true);
    assert.deepEqual(planMonthlyCharge(resolved), {
      amountCents: 29_700,
      feeKind: "monthly",
    });
    assert.deepEqual(planAppointmentCharge(resolved), {
      amountCents: 50_000,
      feeKind: "appointment",
    });
  });

  it("allows negotiated monthly override while appointment stays individual", () => {
    const resolved = resolveCommercialPricing(platform, {
      monthlyFeeEnabled: true,
      monthlyFeeOverrideCents: 19_700,
      appointmentFeeEnabled: true,
      costPerAppointmentCents: 35_000,
    });
    assert.equal(resolved.monthlyUsesGlobalAmount, false);
    assert.equal(resolved.monthlyFeeCents, 19_700);
    assert.equal(resolved.appointmentFeeCents, 35_000);
    assert.deepEqual(planMonthlyCharge(resolved), {
      amountCents: 19_700,
      feeKind: "monthly",
    });
  });

  it("skips appointment charge when fee is turned off", () => {
    const resolved = resolveCommercialPricing(platform, {
      monthlyFeeEnabled: true,
      monthlyFeeOverrideCents: null,
      appointmentFeeEnabled: false,
      costPerAppointmentCents: 40_000,
    });
    assert.equal(planAppointmentCharge(resolved), null);
  });

  it("skips appointment charge when rate is zero", () => {
    const resolved = resolveCommercialPricing(platform, {
      monthlyFeeEnabled: true,
      monthlyFeeOverrideCents: null,
      appointmentFeeEnabled: true,
      costPerAppointmentCents: 0,
    });
    assert.equal(planAppointmentCharge(resolved), null);
  });

  it("does not invent a default appointment rate when the org has none", () => {
    const resolved = resolveCommercialPricing(platform, {
      monthlyFeeEnabled: true,
      monthlyFeeOverrideCents: null,
      appointmentFeeEnabled: true,
      costPerAppointmentCents: null,
    });
    assert.equal(resolved.appointmentFeeCents, 0);
    assert.equal(planAppointmentCharge(resolved), null);
  });
});

describe("money helpers", () => {
  it("formats and parses USD amounts", () => {
    assert.equal(formatUsdFromCents(29700), "$297");
    assert.equal(formatUsdFromCents(40050), "$400.50");
    assert.equal(parseUsdToCents("400"), 40_000);
    assert.equal(parseUsdToCents("$1,497.00"), 149_700);
    assert.equal(parseUsdToCents("bad"), null);
  });
});

describe("billing periods", () => {
  it("builds YYYY-MM keys and month bounds", async () => {
    const {
      billingPeriodKey,
      billingPeriodBounds,
    } = await import("../lib/commercial-pricing-service.js");
    assert.equal(billingPeriodKey(new Date(2026, 8, 3)), "2026-09");
    const bounds = billingPeriodBounds("2026-09");
    assert.equal(bounds.start.getFullYear(), 2026);
    assert.equal(bounds.start.getMonth(), 8);
    assert.equal(bounds.start.getDate(), 1);
    assert.equal(bounds.end.getMonth(), 9);
    assert.equal(bounds.end.getDate(), 1);
    assert.match(bounds.label, /2026/);
    assert.throws(() => billingPeriodBounds("bad"), /Invalid period/);
  });
});

describe("receipt helpers", () => {
  it("builds CSV and printable HTML from a bill", async () => {
    const {
      billToCsv,
      billToPrintHtml,
      chargesToCsv,
      chargesLedgerToPrintHtml,
      formatUsd,
    } = await import("../client/src/lib/billing-receipts.js");
    assert.equal(formatUsd(29700), "$297");
    const bill = {
      organizationName: "Acme Co",
      organizationId: 1,
      period: "2026-09",
      periodLabel: "September 2026",
      breakdown: {
        monthlyCents: 29700,
        appointmentCents: 40000,
        appointmentCount: 1,
        totalCents: 69700,
        paidCents: 29700,
        pendingCents: 40000,
      },
      lines: [
        {
          id: 1,
          feeKind: "monthly",
          status: "paid",
          amountCents: 29700,
          description: "Monthly retainer — 2026-09",
          createdAt: "2026-09-01T00:00:00.000Z",
        },
        {
          id: 2,
          feeKind: "appointment",
          status: "pending",
          amountCents: 40000,
          description: "Booked appointment",
          createdAt: "2026-09-02T00:00:00.000Z",
        },
      ],
    };
    const csv = billToCsv(bill);
    assert.match(csv, /Acme Co/);
    assert.match(csv, /monthly/);
    assert.match(csv, /297\.00/);
    const html = billToPrintHtml(bill);
    assert.match(html, /Leviosai receipt/);
    assert.match(html, /Acme Co/);
    assert.match(html, /Total: \$697/);
    assert.match(html, /window\.print/);
    assert.match(html, /id="print-btn"/);

    const { chargeToPrintHtml, openPrintableHtml: openFnSrc } = await import(
      "../client/src/lib/billing-receipts.js"
    );
    const chargeHtml = chargeToPrintHtml({
      id: 9,
      organizationName: "Acme Co",
      feeKind: "appointment",
      status: "paid",
      amountCents: 40000,
      description: "Booked appointment",
      createdAt: "2026-09-02T00:00:00.000Z",
    });
    assert.match(chargeHtml, /Charge #9/);
    assert.match(chargeHtml, /\$400/);
    assert.match(chargeHtml, /window\.print/);

    const helperSrc = readFileSync(
      path.join(root, "client/src/lib/billing-receipts.js"),
      "utf8"
    );
    assert.match(helperSrc, /createObjectURL/);
    assert.match(helperSrc, /printViaHiddenIframe/);
    assert.doesNotMatch(helperSrc, /w\.document\.write/);
    assert.doesNotMatch(helperSrc, /noopener,noreferrer/);
    void openFnSrc;


    const ledgerCsv = chargesToCsv(bill.lines, { title: "Test" });
    assert.match(ledgerCsv, /payment ledger/i);
    assert.match(ledgerCsv, /Booked appointment/);
    const ledgerHtml = chargesLedgerToPrintHtml(
      bill.lines.map((l) => ({ ...l, organizationName: "Acme Co" })),
      { title: "Ledger", subtitle: "Sep 2026" }
    );
    assert.match(ledgerHtml, /Acme Co/);
    assert.match(ledgerHtml, /Listed total/);
  });
});

describe("wiring", () => {
  it("exposes admin commercial pricing routes and booking charge hook", () => {
    const admin = readFileSync(path.join(root, "routes/admin.ts"), "utf8");
    assert.match(admin, /\/api\/admin\/commercial-pricing/);
    assert.match(admin, /\/api\/admin\/pricing\/clients/);
    assert.match(admin, /\/api\/admin\/organizations\/:id\/commercial-pricing/);
    assert.match(admin, /\/api\/admin\/payments/);
    assert.match(admin, /\/api\/admin\/payments\/bill\/:orgId/);
    assert.match(admin, /\/api\/admin\/payments\/:id\/status/);
    assert.match(admin, /feeKind|summarizeCharges|req\.query\.q|req\.query\.year/);

    const billingRoutes = readFileSync(path.join(root, "routes/billing.ts"), "utf8");
    assert.match(billingRoutes, /\/api\/billing\/bill/);
    assert.match(billingRoutes, /\/api\/billing\/receipts/);
    assert.match(billingRoutes, /req\.query\.year|feeKind|summarizeCharges/);

    const calendar = readFileSync(path.join(root, "lib/calendar/service.ts"), "utf8");
    assert.match(calendar, /recordBookingAppointmentCharge/);

    const detail = readFileSync(
      path.join(root, "client/src/components/admin/WorkspaceDetail.jsx"),
      "utf8"
    );
    assert.match(detail, /Commercial pricing/);
    assert.match(detail, /cannot disable|always on/i);
    assert.match(detail, /saveOrgCommercialPricing/);
    assert.doesNotMatch(detail, /Capacity profile|ADMIN_TIER_OPTIONS/);

    const pricingUi = readFileSync(
      path.join(root, "client/src/components/admin/CommercialPricingSettings.jsx"),
      "utf8"
    );
    assert.match(pricingUi, /Global monthly retainer|getPricingClients|Edit rates|User details/);
    assert.doesNotMatch(pricingUi, /Default appointment fee/);
    assert.match(pricingUi, /Existing charges|cannot be disabled|new booking/);
    assert.ok(existsSync(path.join(root, "client/src/pages/admin-pricing.css")));

    assert.ok(
      existsSync(path.join(root, "client/src/components/admin/CommercialPricingSettings.jsx"))
    );
    const panel = readFileSync(path.join(root, "client/src/pages/AdminPanel.jsx"), "utf8");
    assert.match(panel, /CommercialPricingSettings/);
    assert.match(panel, /pricing|payments|AdminPaymentsPage/i);
    assert.match(panel, /admin-shell|admin-nav-item/);
    assert.match(panel, /\/admin\/pricing|ADMIN_PAGE_PATHS/);
    assert.doesNotMatch(panel, /maxWidth:\s*\d+ch[^"']/);

    const payments = readFileSync(
      path.join(root, "client/src/components/admin/AdminPaymentsPage.jsx"),
      "utf8"
    );
    assert.match(payments, /Payment Management|Quick filters|Export CSV|Payment details/);
    assert.match(payments, /Print receipt|printOrWarn|openPrintableCharge/);

    const billing = readFileSync(path.join(root, "client/src/pages/BillingPage.jsx"), "utf8");
    assert.match(billing, /monthly retainer|Per appointment|commercialPricing|This month/i);
    assert.doesNotMatch(billing, /Available plans|Starter through Enterprise/);
    assert.match(billing, /getBill|Print bill|Payment history|getReceipts|Quick filters/);
    assert.match(billing, /Cancel subscription|billing date|charged automatically/i);
    assert.doesNotMatch(billing, /UpgradePrompt|leadsLimit|leadsUnlimited/);

    const usageBar = readFileSync(path.join(root, "client/src/components/billing/UsageBar.jsx"), "utf8");
    assert.match(usageBar, /Leads enrolled/);
    assert.match(usageBar, /Call minutes/);
    assert.doesNotMatch(usageBar, /progressbar|leadsLimit|upgrade plan| \/ /);

    const dashboard = readFileSync(path.join(root, "client/src/App.jsx"), "utf8");
    assert.doesNotMatch(dashboard, /Near limit|upgrade plan/);
    assert.ok(existsSync(path.join(root, "client/src/components/admin/AdminPaymentsPage.jsx")));
    assert.ok(existsSync(path.join(root, "client/src/pages/admin-payments.css")));

    const onboard = readFileSync(
      path.join(root, "client/src/components/onboarding/OnboardingStep1.jsx"),
      "utf8"
    );
    assert.match(onboard, /Activate monthly billing|Activate your account/);
    assert.doesNotMatch(onboard, /Choose a plan/);
  });
});
