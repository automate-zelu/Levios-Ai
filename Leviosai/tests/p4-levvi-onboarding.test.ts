import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ONBOARDING_STEP_LABELS,
  ONBOARDING_DRAFT_KEY,
  isBusinessDraftComplete,
  isAvailabilityDraftComplete,
  isKbStepComplete,
  firstIncompleteLevviStep,
  readOnboardingDraft,
  writeOnboardingDraft,
  clearOnboardingStorage,
  LEVVI_LAST_STEP,
} from "../lib/onboarding.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

describe("P4 Levvi onboarding", () => {
  it("defines the eight Levvi wizard steps from the plan", () => {
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
  });

  it("validates business and availability drafts", () => {
    assert.equal(isBusinessDraftComplete({}), false);
    assert.equal(isBusinessDraftComplete({ companyName: "Acme", industry: "HVAC" }), true);
    assert.equal(isAvailabilityDraftComplete({ timezone: "UTC" }), false);
    assert.equal(
      isAvailabilityDraftComplete({ timezone: "UTC", weekdayStart: "09:00", weekdayEnd: "17:00" }),
      true
    );
  });

  it("treats short KB as incomplete", () => {
    assert.equal(isKbStepComplete(null), false);
    assert.equal(isKbStepComplete({ knowledgeBase: "too short" }), false);
    assert.equal(
      isKbStepComplete({
        knowledgeBase: "We offer AC repair, maintenance plans, and emergency service 24/7 for homeowners.",
      }),
      true
    );
  });

  it("skips to first incomplete step for resume", () => {
    assert.equal(firstIncompleteLevviStep({}), 2);
    assert.equal(
      firstIncompleteLevviStep({
        draft: { companyName: "Acme", industry: "Solar" },
      }),
      3
    );
    assert.equal(
      firstIncompleteLevviStep({
        draft: {
          companyName: "Acme",
          industry: "Solar",
          timezone: "America/New_York",
          weekdayStart: "09:00",
          weekdayEnd: "17:00",
        },
        leadCount: 0,
      }),
      5
    );
    assert.equal(
      firstIncompleteLevviStep({
        draft: {
          companyName: "Acme",
          industry: "Solar",
          timezone: "America/New_York",
          weekdayStart: "09:00",
          weekdayEnd: "17:00",
          leadsSkipped: true,
        },
        leadCount: 0,
        config: {
          systemPrompt: "p",
          smsTemplate: "s",
          emailSubject: "e",
          emailBody: "b",
        },
      }),
      7
    );
    assert.equal(
      firstIncompleteLevviStep({
        draft: {
          companyName: "Acme",
          industry: "Solar",
          timezone: "America/New_York",
          weekdayStart: "09:00",
          weekdayEnd: "17:00",
          leadsSkipped: true,
          kbSkipped: true,
        },
        leadCount: 2,
        config: {
          systemPrompt: "p",
          smsTemplate: "s",
          emailSubject: "e",
          emailBody: "b",
          knowledgeBase: "x".repeat(50),
        },
      }),
      LEVVI_LAST_STEP
    );
  });

  it("persists onboarding draft in storage", () => {
    const mem: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => mem[k] ?? null,
      setItem: (k: string, v: string) => {
        mem[k] = v;
      },
      removeItem: (k: string) => {
        delete mem[k];
      },
    };
    writeOnboardingDraft({ companyName: "Acme", industry: "HVAC" }, storage);
    assert.equal(mem[ONBOARDING_DRAFT_KEY]?.includes("Acme"), true);
    const draft = readOnboardingDraft(storage);
    assert.equal(draft.companyName, "Acme");
    clearOnboardingStorage(storage);
    assert.equal(mem[ONBOARDING_DRAFT_KEY], undefined);
  });

  it("wires Levvi wizard shell and step components", () => {
    const shell = read("client/src/pages/SDROnboarding.jsx");
    assert.match(shell, /Levvi/);
    assert.match(shell, /firstIncompleteLevviStep/);
    assert.match(shell, /LevviWelcome/);
    assert.match(shell, /LevviKnowledge/);
    assert.match(shell, /hideKnowledgeBase/);

    const steps = read("client/src/components/onboarding/LevviSteps.jsx");
    assert.match(steps, /LevviSpeakButton/);
    assert.match(steps, /speechSynthesis/);
    assert.match(steps, /Import leads/);
    assert.match(steps, /Connect channels/);
  });

  it("documents voice spike and NL backlog", () => {
    const voice = read("docs/P4_VOICE_SPIKE.md");
    assert.match(voice, /Decision gate/);
    assert.match(voice, /Defer full voice onboarding/);

    const nl = read("docs/P4_NL_CONFIG_BACKLOG.md");
    assert.match(nl, /Confirm before write/);
    assert.match(nl, /Audit log/);
    assert.match(nl, /not required for P4/i);
  });
});
