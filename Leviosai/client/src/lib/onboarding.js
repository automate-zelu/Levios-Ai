// Client-side Levvi onboarding helpers (mirrors Leviosai/lib/onboarding.ts).

export const ONBOARDING_STORAGE_KEY = "catalyst_onboarding_step";
export const ONBOARDING_FLAG_KEY = "catalyst_needs_onboarding";
export const ONBOARDING_DRAFT_KEY = "catalyst_onboarding_draft";

/**
 * Levvi wizard — Knowledge is skippable; Launch requires paid billing (no free tier).
 * Aligns with Catalyst plan / SOW: retainer required before going live.
 */
export const ONBOARDING_STEP_LABELS = [
  "Welcome",
  "Catalyst",
  "Business",
  "Availability",
  "Channels",
  "Leads",
  "Agent",
  "Knowledge",
  "Launch",
];

export const LEVVI_STEP_COUNT = ONBOARDING_STEP_LABELS.length;
export const LEVVI_LAST_STEP = LEVVI_STEP_COUNT - 1;
export const LEVVI_KB_STEP = 7;
export const LEVVI_LAUNCH_STEP = 8;

export function clampOnboardingStep(value) {
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > LEVVI_LAST_STEP) return LEVVI_LAST_STEP;
  return n;
}

export function readStoredOnboardingStep(storage = typeof localStorage !== "undefined" ? localStorage : { getItem: () => null }) {
  return clampOnboardingStep(storage.getItem(ONBOARDING_STORAGE_KEY) ?? "0");
}

export function writeStoredOnboardingStep(step, storage = typeof localStorage !== "undefined" ? localStorage : { setItem: () => {} }) {
  storage.setItem(ONBOARDING_STORAGE_KEY, String(clampOnboardingStep(step)));
}

export function clearOnboardingStorage(storage = typeof localStorage !== "undefined" ? localStorage : { removeItem: () => {} }) {
  storage.removeItem(ONBOARDING_STORAGE_KEY);
  storage.removeItem(ONBOARDING_FLAG_KEY);
  storage.removeItem(ONBOARDING_DRAFT_KEY);
}

export function readOnboardingDraft(storage = typeof localStorage !== "undefined" ? localStorage : { getItem: () => null }) {
  try {
    const raw = storage.getItem(ONBOARDING_DRAFT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeOnboardingDraft(draft, storage = typeof localStorage !== "undefined" ? localStorage : { setItem: () => {} }) {
  storage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(draft || {}));
}

export function shouldShowOnboarding(user) {
  if (!user) return false;
  if (user.role === "admin") return false;
  return user.onboardingComplete === false;
}

export function isSubscribeStepComplete(billing) {
  return !!billing?.sdr?.isActive;
}

export function isConfigureStepComplete(config) {
  if (!config) return false;
  return !!(
    config.systemPrompt?.trim() &&
    config.smsTemplate?.trim() &&
    config.emailSubject?.trim() &&
    config.emailBody?.trim()
  );
}

export function isActivateStepComplete(config) {
  return !!config?.isActive;
}

export function isBusinessDraftComplete(draft) {
  return !!(draft?.companyName?.trim() && draft?.industry?.trim());
}

export function isAvailabilityDraftComplete(draft) {
  return !!(draft?.timezone?.trim() && draft?.weekdayStart && draft?.weekdayEnd);
}

export function isKbStepComplete(config) {
  return !!(config?.knowledgeBase && String(config.knowledgeBase).trim().length >= 40);
}

export function isBillingActive(billing) {
  return !!billing?.sdr?.isActive;
}

/**
 * First incomplete Levvi step index for resume / skip-completed.
 * KB (7) may be skipped via draft.kbSkipped; Launch (8) always required until billed.
 */
export function firstIncompleteLevviStep({ draft = {}, billing = null, config = null, leadCount = 0 } = {}) {
  if (!isBusinessDraftComplete(draft)) return 2;
  if (!isAvailabilityDraftComplete(draft)) return 3;
  if (leadCount <= 0 && !draft.leadsSkipped) return 5;
  if (!isConfigureStepComplete(config)) return 6;
  if (!isKbStepComplete(config) && !draft.kbSkipped) return LEVVI_KB_STEP;
  if (!isBillingActive(billing)) return LEVVI_LAUNCH_STEP;
  return LEVVI_LAUNCH_STEP;
}
