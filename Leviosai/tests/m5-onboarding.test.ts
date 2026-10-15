import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clampOnboardingStep,
  shouldShowOnboarding,
  isSubscribeStepComplete,
  isConfigureStepComplete,
  isActivateStepComplete,
  readStoredOnboardingStep,
  writeStoredOnboardingStep,
  clearOnboardingStorage,
  ONBOARDING_STORAGE_KEY,
  ONBOARDING_FLAG_KEY,
  ONBOARDING_DRAFT_KEY,
  ONBOARDING_STEP_LABELS,
  LEVVI_LAST_STEP,
} from "../lib/onboarding.js";

describe("M5 / P4 Levvi onboarding helpers", () => {
  it("exposes eight Levvi step labels", () => {
    assert.equal(ONBOARDING_STEP_LABELS.length, 8);
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
    assert.equal(LEVVI_LAST_STEP, 7);
  });

  it("clamps step indices to 0–7", () => {
    assert.equal(clampOnboardingStep(-1), 0);
    assert.equal(clampOnboardingStep(0), 0);
    assert.equal(clampOnboardingStep(4), 4);
    assert.equal(clampOnboardingStep(7), 7);
    assert.equal(clampOnboardingStep(99), 7);
    assert.equal(clampOnboardingStep("3"), 3);
    assert.equal(clampOnboardingStep("nope"), 0);
  });

  it("shows wizard only when onboardingComplete is false", () => {
    assert.equal(shouldShowOnboarding(null), false);
    assert.equal(shouldShowOnboarding({ role: "admin", onboardingComplete: false }), false);
    assert.equal(shouldShowOnboarding({ role: "user", onboardingComplete: true }), false);
    assert.equal(shouldShowOnboarding({ role: "user", onboardingComplete: false }), true);
    assert.equal(shouldShowOnboarding({ role: "user" }), false);
  });

  it("detects subscribe / configure / activate completion", () => {
    assert.equal(isSubscribeStepComplete(null), false);
    assert.equal(isSubscribeStepComplete({ sdr: { isActive: false } }), false);
    assert.equal(isSubscribeStepComplete({ sdr: { isActive: true } }), true);

    assert.equal(isConfigureStepComplete(null), false);
    assert.equal(
      isConfigureStepComplete({
        systemPrompt: "hi",
        smsTemplate: "sms",
        emailSubject: "sub",
        emailBody: "body",
      }),
      true
    );
    assert.equal(
      isConfigureStepComplete({
        systemPrompt: "hi",
        smsTemplate: "",
        emailSubject: "sub",
        emailBody: "body",
      }),
      false
    );

    assert.equal(isActivateStepComplete({ isActive: true }), true);
    assert.equal(isActivateStepComplete({ isActive: false }), false);
  });

  it("persists step progress in a storage stub", () => {
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

    writeStoredOnboardingStep(5, storage);
    assert.equal(mem[ONBOARDING_STORAGE_KEY], "5");
    assert.equal(readStoredOnboardingStep(storage), 5);

    mem[ONBOARDING_FLAG_KEY] = "1";
    mem[ONBOARDING_DRAFT_KEY] = "{}";
    clearOnboardingStorage(storage);
    assert.equal(mem[ONBOARDING_STORAGE_KEY], undefined);
    assert.equal(mem[ONBOARDING_FLAG_KEY], undefined);
    assert.equal(mem[ONBOARDING_DRAFT_KEY], undefined);
  });
});
