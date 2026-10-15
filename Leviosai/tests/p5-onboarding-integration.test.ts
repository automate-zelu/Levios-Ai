import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeProvisionInput,
  normalizePrefill,
  prefillToOnboardingDraft,
  buildHandoffClaims,
  parseHandoffClaims,
  buildHandoffLandingUrl,
  buildOutboundWebhookPayload,
  createJtiStore,
  timingSafeEqualString,
  HANDOFF_PURPOSE,
  DEFAULT_HANDOFF_TTL_SECONDS,
} from "../lib/onboarding-handoff.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

describe("P5 onboarding handoff helpers", () => {
  it("normalizes provision input and rejects bad email", () => {
    const bad = normalizeProvisionInput({ email: "nope", firstName: "A", lastName: "B" });
    assert.equal(bad.ok, false);

    const good = normalizeProvisionInput({
      email: " Owner@Acme.COM ",
      firstName: "Alex",
      lastName: "Lee",
      organizationName: "Acme",
      industry: "HVAC",
      path: "staff_assisted",
      externalOrgId: "oa_1",
      prefill: { timezone: "UTC", weekdayStart: "09:00", weekdayEnd: "17:00" },
    });
    assert.equal(good.ok, true);
    if (!good.ok) return;
    assert.equal(good.value.email, "owner@acme.com");
    assert.equal(good.value.path, "staff_assisted");
    assert.equal(good.value.prefill.companyName, "Acme");
    assert.equal(good.value.prefill.industry, "HVAC");
    assert.equal(good.value.prefill.timezone, "UTC");
  });

  it("maps prefill to Levvi draft keys", () => {
    const draft = prefillToOnboardingDraft(
      normalizePrefill({
        companyName: "Acme",
        industry: "Solar",
        leadsSkipped: true,
        step: 99,
      })
    );
    assert.equal(draft.companyName, "Acme");
    assert.equal(draft.leadsSkipped, true);
    assert.equal(normalizePrefill({ step: 99 }).step, 7);
  });

  it("builds and parses handoff claims", () => {
    const claims = buildHandoffClaims({
      jti: "abc",
      userId: 1,
      organizationId: 2,
      workspaceId: "ws-1",
      email: "a@b.com",
      path: "self_serve",
      prefill: { companyName: "X" },
    });
    assert.equal(claims.purpose, HANDOFF_PURPOSE);
    const parsed = parseHandoffClaims(claims);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value.workspaceId, "ws-1");
    assert.equal(parseHandoffClaims({ purpose: "other" }).ok, false);
  });

  it("builds handoff landing URL and webhook payload", () => {
    assert.equal(
      buildHandoffLandingUrl("https://app.example/", "tok"),
      "https://app.example/?handoff=tok"
    );
    const payload = buildOutboundWebhookPayload({
      type: "sdr.activated",
      organizationId: 9,
      workspaceId: "w",
      userId: 1,
      email: "a@b.com",
    });
    assert.equal(payload.type, "sdr.activated");
    assert.equal(payload.organizationId, 9);
    assert.ok(payload.occurredAt);
    assert.equal(DEFAULT_HANDOFF_TTL_SECONDS, 900);
  });

  it("consumes jti only once", () => {
    const store = createJtiStore(60_000);
    assert.equal(store.consume("j1"), true);
    assert.equal(store.consume("j1"), false);
    assert.equal(store.has("j1"), true);
    assert.equal(store.consume("j2"), true);
  });

  it("compares API keys in constant-ish time", () => {
    assert.equal(timingSafeEqualString("secret", "secret"), true);
    assert.equal(timingSafeEqualString("secret", "secreT"), false);
    assert.equal(timingSafeEqualString("a", "ab"), false);
  });

  it("registers integration routes and client handoff landing", () => {
    const server = read("server.ts");
    assert.match(server, /onboarding-integration/);

    const routes = read("routes/onboarding-integration.ts");
    assert.match(routes, /\/api\/integrations\/onboarding\/provision/);
    assert.match(routes, /\/api\/integrations\/onboarding\/exchange/);
    assert.match(routes, /\/api\/integrations\/onboarding\/handoff/);
    assert.match(routes, /\/api\/integrations\/onboarding\/events/);
    assert.match(routes, /X-Onboarding-Api-Key|x-onboarding-api-key/);

    const app = read("client/src/App.jsx");
    assert.match(app, /exchangeOnboardingHandoff/);
    assert.match(app, /applyHandoffPrefill/);
    assert.match(app, /handoff/);

    const auth = read("routes/auth.ts");
    assert.match(auth, /onboarding\.completed/);

    const sdr = read("routes/sdr.ts");
    assert.match(sdr, /sdr\.activated/);
  });

  it("documents integration contract and ops runbook", () => {
    const contract = read("docs/P5_ONBOARDING_APP_INTEGRATION.md");
    assert.match(contract, /Field ownership/);
    assert.match(contract, /self_serve/);
    assert.match(contract, /staff_assisted/);
    assert.match(contract, /ONBOARDING_APP_API_KEY/);

    const runbook = read("docs/P5_OPS_RUNBOOK.md");
    assert.match(runbook, /Staff-assisted/);
    assert.match(runbook, /Handoff expired/);
  });
});
