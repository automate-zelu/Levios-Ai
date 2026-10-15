/**
 * Catalyst Dev Task Implementation Plan — end-to-end coverage matrix.
 * Maps CATALYST_DEV_TASK_IMPLEMENTATION_PLAN.md phase exits + key deliverables
 * to automated assertions. Run with: npm run test:catalyst
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "..");

function read(rel: string, base = root) {
  return readFileSync(path.join(base, rel), "utf8");
}

function mustExist(...rels: string[]) {
  for (const rel of rels) {
    assert.ok(existsSync(path.join(root, rel)), `missing ${rel}`);
  }
}

describe("Catalyst plan — artifact inventory", () => {
  it("implementation plan exists at repo root", () => {
    assert.ok(existsSync(path.join(repoRoot, "CATALYST_DEV_TASK_IMPLEMENTATION_PLAN.md")));
  });

  it("ships P0–P5 dedicated test files", () => {
    mustExist(
      "tests/p0-client-bugs.test.ts",
      "tests/p1-billing.test.ts",
      "tests/p2-core-ux.test.ts",
      "tests/p3-agents-comms.test.ts",
      "tests/p4-levvi-onboarding.test.ts",
      "tests/p5-onboarding-integration.test.ts",
      "tests/m5-onboarding.test.ts"
    );
  });
});

describe("P0 exit — live bugs", () => {
  const app = read("client/src/App.jsx");
  const css = read("client/src/styles.css");
  const html = read("client/index.html");

  it("P0.1 mobile viewport meta + overflow + sidebar shrink", () => {
    assert.match(html, /name="viewport"/);
    assert.match(html, /viewport-fit=cover/);
    assert.match(html, /overflow-x:\s*hidden/);
    assert.match(css, /\.catalyst-main[\s\S]*min-width:\s*0/);
    assert.match(css, /flex:\s*0\s+0\s+0\s*!important/);
  });

  it("P0.2 phantom replay removed — API-backed empty state", () => {
    mustExist("client/src/lib/conversation-replay.js");
    const start = app.indexOf("function ConversationReplayPage()");
    assert.ok(start > 0);
    const block = app.slice(start, app.indexOf("\nfunction ", start + 10));
    assert.match(block, /callApi\.getSessions|messagesApi\.recent/);
    assert.match(block, /No conversations yet/);
    assert.doesNotMatch(block, /SAMPLE_LEADS/);
  });

  it("P0.3 proposals no false logoUploaded white-label state", () => {
    const start = app.indexOf("function ProposalsPage()");
    assert.ok(start > 0);
    const block = app.slice(start, app.indexOf("\nfunction ", start + 10));
    assert.doesNotMatch(block, /logoUploaded:\s*true/);
    assert.doesNotMatch(block, /White-Label Proposal Branding/);
  });

  it("P0.4 notification bell is tappable button ≥44px", () => {
    assert.match(app, /className="notif-bell-btn"/);
    assert.match(app, /aria-label="Notifications"/);
    assert.match(css, /\.notif-bell-btn[\s\S]*min-width:\s*44px/);
    assert.match(app, /className="notif-panel"/);
  });
});

describe("P1 exit — billing & pricing", () => {
  it("P1.1 $297 documented as DEFAULT_GLOBAL_MONTHLY_FEE_CENTS", async () => {
    const { DEFAULT_GLOBAL_MONTHLY_FEE_CENTS, marketingNameForPlan } = await import(
      "../lib/commercial-pricing.js"
    );
    assert.equal(DEFAULT_GLOBAL_MONTHLY_FEE_CENTS, 29_700);
    assert.equal(marketingNameForPlan("starter"), "Ignite");
    assert.match(read("lib/commercial-pricing.ts"), /Where does \$297 come from/);
  });

  it("P1.2 admin can set per-client monthly fee fields", () => {
    assert.match(read("routes/admin.ts"), /monthlyFeeOverrideCents|monthly_fee_override/);
    assert.match(read("client/src/components/admin/CommercialPricingSettings.jsx"), /monthlyFee/);
    assert.match(read("lib/schema.ts"), /monthlyFeeOverrideCents|monthly_fee_override_cents/);
  });

  it("P1.3 hybrid usage path + usage_events", async () => {
    mustExist("lib/usage-billing.ts");
    const { USAGE_METERING_MATRIX, listBillableMeters } = await import("../lib/usage-billing.js");
    assert.ok(USAGE_METERING_MATRIX.length >= 3);
    assert.ok(listBillableMeters().some((m: { id: string }) => m.id === "appointment_booked"));
    assert.match(read("lib/schema.ts"), /usageEvents|usage_events/);
  });

  it("P1.4 pause rules + exemption + banner", async () => {
    mustExist("lib/billing-pause.ts");
    const { shouldAutoPauseOnPaymentFailure, SERVICE_PAUSED_BANNER } = await import(
      "../lib/billing-pause.js"
    );
    assert.equal(shouldAutoPauseOnPaymentFailure({ pauseExempt: true }), false);
    assert.equal(shouldAutoPauseOnPaymentFailure({}), true);
    assert.match(SERVICE_PAUSED_BANNER, /Service paused/);
    assert.match(read("client/src/App.jsx"), /Service paused — update payment/);
    assert.match(read("lib/stripe.ts"), /pauseOrgForNonPayment|resumeOrgAfterPayment/);
  });

  it("P1.5 per-appointment asterisk + Leviosa Labs footnote", async () => {
    const { PER_APPOINTMENT_FOOTNOTE, PER_APPOINTMENT_ASTERISK } = await import(
      "../lib/commercial-pricing.js"
    );
    assert.equal(PER_APPOINTMENT_ASTERISK, "*");
    assert.match(PER_APPOINTMENT_FOOTNOTE, /Leviosa Labs/);
    assert.match(read("client/src/pages/BillingPage.jsx"), /Per appointment\*/);
  });
});

describe("P2 exit — core UX", () => {
  const app = read("client/src/App.jsx");

  it("P2.1 dashboard: no TCPA chrome badge, no fake charts", () => {
    assert.doesNotMatch(app, /TCPA Compliant/);
    assert.doesNotMatch(app, /function ComplianceBadge/);
    assert.doesNotMatch(app, /month: "Oct", revived: 45/);
    assert.match(app, /Pipeline snapshot|No pipeline data yet|Open calendar/);
  });

  it("P2.2 calendar day/week/month primary booking UX", () => {
    mustExist("client/src/lib/booking-calendar.js", "client/src/pages/BookingsPage.jsx");
    const bookings = read("client/src/pages/BookingsPage.jsx");
    assert.match(bookings, /day|week|month/i);
    assert.match(bookings, /bookings-cal/);
  });

  it("P2.3 lead timeline replaces standalone Replay nav", () => {
    mustExist(
      "client/src/lib/lead-timeline.js",
      "client/src/components/leads/LeadTimelinePanel.jsx"
    );
    assert.match(read("client/src/pages/LeadDetailPage.jsx"), /LeadTimelinePanel/);
    assert.doesNotMatch(app, /name: "Conversation Replay"/);
    assert.match(app, /\/replay/);
  });

  it("P2.4 proposals simplified — no financing grid / white-label box", () => {
    const start = app.indexOf("function ProposalsPage()");
    const block = app.slice(start, app.indexOf("\nfunction ", start + 10));
    assert.doesNotMatch(block, /Financing Options/);
    assert.doesNotMatch(block, /White-Label/);
    assert.match(block, /Package|packageType/);
  });

  it("P2.5 sandbox gated for normal customers", async () => {
    mustExist("client/src/lib/sandbox-access.js", "lib/sandbox-gate.ts");
    const { canAccessSandbox } = await import("../client/src/lib/sandbox-access.js");
    assert.equal(canAccessSandbox("user"), false);
    assert.equal(canAccessSandbox("admin"), true);
    assert.match(read("routes/sandbox.ts"), /requireSandboxAccess/);
    assert.match(app, /canAccessSandbox/);
  });
});

describe("P3 exit — agents & communications", () => {
  it("P3.1 SDR ops console as daily operator screen", () => {
    mustExist("client/src/components/sdr/SdrOpsConsole.jsx");
    const page = read("client/src/pages/SDRConfigPage.jsx");
    assert.match(page, /SdrOpsConsole/);
    assert.match(page, /tab === "console"/);
    const ops = read("client/src/components/sdr/SdrOpsConsole.jsx");
    assert.match(ops, /Needs human|Leads being worked|Appointments generated/);
  });

  it("P3.2 one agent × many KBs — no industry agent forks", () => {
    const app = read("client/src/App.jsx");
    assert.doesNotMatch(app, /SolarAgent|HvacAgent|\/solar-agent|\/hvac-agent/);
    assert.match(read("client/src/components/sdr/KnowledgeBaseInput.jsx"), /Industry differences|same agent UI/);
    assert.match(read("client/src/pages/SDRConfigPage.jsx"), /One agent for all industries/);
  });

  it("P3.3 unified inbox; legacy SMS/Email nav retired", () => {
    const app = read("client/src/App.jsx");
    assert.match(app, /name: "Inbox"/);
    assert.doesNotMatch(app, /name: "SMS Inbox"/);
    assert.doesNotMatch(app, /name: "Email Inbox"/);
    assert.match(read("client/src/pages/MessageInboxPage.jsx"), /channel === "all"|channelProp = "all"/);
    assert.match(read("routes/api.ts"), /sms, email, or all/);
  });
});

describe("P4 exit — Levvi onboarding", () => {
  it("P4.1 eight-step Levvi wizard with resume helpers", async () => {
    const {
      ONBOARDING_STEP_LABELS,
      LEVVI_LAST_STEP,
      firstIncompleteLevviStep,
      shouldShowOnboarding,
    } = await import("../lib/onboarding.js");
    assert.equal(ONBOARDING_STEP_LABELS.length, 8);
    assert.equal(LEVVI_LAST_STEP, 7);
    assert.deepEqual([...ONBOARDING_STEP_LABELS], [
      "Welcome",
      "Catalyst",
      "Business",
      "Availability",
      "Channels",
      "Leads",
      "Agent",
      "Knowledge",
    ]);
    assert.equal(shouldShowOnboarding({ role: "user", onboardingComplete: false }), true);
    assert.equal(firstIncompleteLevviStep({}), 2);
    mustExist(
      "client/src/pages/SDROnboarding.jsx",
      "client/src/components/onboarding/LevviSteps.jsx"
    );
    assert.match(read("client/src/pages/SDROnboarding.jsx"), /Levvi|firstIncompleteLevviStep/);
  });

  it("P4.2 voice spike documented + TTS control present", () => {
    mustExist("docs/P4_VOICE_SPIKE.md");
    assert.match(read("docs/P4_VOICE_SPIKE.md"), /Decision gate|Defer/);
    assert.match(read("client/src/components/onboarding/LevviSteps.jsx"), /speechSynthesis|LevviSpeakButton/);
  });

  it("P4.3 NL config backlog parked", () => {
    mustExist("docs/P4_NL_CONFIG_BACKLOG.md");
    assert.match(read("docs/P4_NL_CONFIG_BACKLOG.md"), /Confirm before write|Audit log/i);
  });
});

describe("P5 exit — external onboarding app", () => {
  it("P5 integration routes + handoff client landing", () => {
    mustExist(
      "routes/onboarding-integration.ts",
      "lib/onboarding-handoff.ts",
      "lib/onboarding-webhooks.ts",
      "client/src/lib/handoff-landing.js",
      "docs/P5_ONBOARDING_APP_INTEGRATION.md",
      "docs/P5_OPS_RUNBOOK.md"
    );
    assert.match(read("server.ts"), /onboarding-integration/);
    assert.match(read("routes/onboarding-integration.ts"), /\/provision|\/exchange|\/handoff|\/events/);
    assert.match(read("client/src/App.jsx"), /exchangeOnboardingHandoff|applyHandoffPrefill/);
    assert.match(read("routes/auth.ts"), /onboarding\.completed/);
    assert.match(read("routes/sdr.ts"), /sdr\.activated/);
  });

  it("P5 handoff helpers: idempotent email normalize + single-use jti", async () => {
    const {
      normalizeProvisionInput,
      createJtiStore,
      buildHandoffLandingUrl,
      prefillToOnboardingDraft,
    } = await import("../lib/onboarding-handoff.js");
    const ok = normalizeProvisionInput({
      email: "A@B.COM",
      firstName: "A",
      lastName: "B",
      organizationName: "Org",
    });
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.value.email, "a@b.com");
    const store = createJtiStore();
    assert.equal(store.consume("x"), true);
    assert.equal(store.consume("x"), false);
    assert.match(buildHandoffLandingUrl("https://x.com", "c"), /handoff=c/);
    assert.equal(prefillToOnboardingDraft({ companyName: "Z" }).companyName, "Z");
  });

  it("P5 client handoff landing applies prefill + step", async () => {
    const { readHandoffCodeFromSearch, prefillToOnboardingDraft } = await import(
      "../client/src/lib/handoff-landing.js"
    );
    assert.equal(readHandoffCodeFromSearch("?handoff=abc"), "abc");
    assert.equal(readHandoffCodeFromSearch("?onboarding_handoff=z"), "z");
    assert.equal(prefillToOnboardingDraft({ industry: "HVAC" }).industry, "HVAC");
    assert.equal(
      prefillToOnboardingDraft({
        companyName: "Acme",
        timezone: "UTC",
        leadsSkipped: true,
      }).companyName,
      "Acme"
    );
    assert.match(read("client/src/lib/handoff-landing.js"), /applyHandoffPrefill|writeStoredOnboardingStep/);
  });
});

describe("Cross-cutting plan replies (documented)", () => {
  it("Anthony answer surfaces exist for $297, voice, P5 contract", () => {
    assert.match(read("lib/commercial-pricing.ts"), /\$297|Ignite/);
    assert.match(read("docs/P4_VOICE_SPIKE.md"), /Anthony|Decision/);
    assert.match(read("docs/P5_ONBOARDING_APP_INTEGRATION.md"), /Field ownership|ONBOARDING_APP_API_KEY/);
  });
});
