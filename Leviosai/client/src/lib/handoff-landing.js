/**
 * P5 — apply external onboarding app handoff to local session + Levvi draft.
 */
import {
  writeOnboardingDraft,
  writeStoredOnboardingStep,
  clampOnboardingStep,
  readOnboardingDraft,
} from "./onboarding.js";

/** Convert API prefill → draft keys (mirrors server prefillToOnboardingDraft). */
export function prefillToOnboardingDraft(prefill = {}) {
  const draft = {};
  if (prefill.companyName) draft.companyName = prefill.companyName;
  if (prefill.industry) draft.industry = prefill.industry;
  if (prefill.website) draft.website = prefill.website;
  if (prefill.timezone) draft.timezone = prefill.timezone;
  if (prefill.weekdayStart) draft.weekdayStart = prefill.weekdayStart;
  if (prefill.weekdayEnd) draft.weekdayEnd = prefill.weekdayEnd;
  if (prefill.leadsSkipped) draft.leadsSkipped = true;
  if (prefill.kbSkipped) draft.kbSkipped = true;
  if (prefill.channelsSkipped) draft.channelsSkipped = true;
  return draft;
}

export function applyHandoffPrefill(prefill) {
  const incoming = prefillToOnboardingDraft(prefill || {});
  const merged = { ...readOnboardingDraft(), ...incoming };
  writeOnboardingDraft(merged);
  if (typeof prefill?.step === "number") {
    writeStoredOnboardingStep(clampOnboardingStep(prefill.step));
  } else if (merged.companyName && merged.industry && merged.timezone) {
    // Skip intro + business + availability when fully prefilled
    writeStoredOnboardingStep(4);
  } else if (merged.companyName && merged.industry) {
    writeStoredOnboardingStep(3);
  } else {
    writeStoredOnboardingStep(2);
  }
  return merged;
}

export function readHandoffCodeFromSearch(search = typeof window !== "undefined" ? window.location.search : "") {
  const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
  return params.get("handoff") || params.get("onboarding_handoff") || "";
}

export function stripHandoffFromUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("handoff") && !url.searchParams.has("onboarding_handoff")) return;
  url.searchParams.delete("handoff");
  url.searchParams.delete("onboarding_handoff");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}
