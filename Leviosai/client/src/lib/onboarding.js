// Client-side copy of onboarding helpers (mirrors Leviosai/lib/onboarding.ts).

export const ONBOARDING_STORAGE_KEY = "catalyst_onboarding_step";
export const ONBOARDING_FLAG_KEY = "catalyst_needs_onboarding";

export const ONBOARDING_STEP_LABELS = ["Subscribe", "Configure SDR", "Activate"];

export function clampOnboardingStep(value) {
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 2) return 2;
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
