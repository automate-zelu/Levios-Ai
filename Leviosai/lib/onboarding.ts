// ─── ONBOARDING HELPERS ──────────────────────────────────────────────────────
// Pure helpers for the 3-step SDR onboarding wizard (plan §13.4).
// Step progress is stored in localStorage; completion is persisted on the user.

export const ONBOARDING_STORAGE_KEY = "catalyst_onboarding_step";
export const ONBOARDING_FLAG_KEY = "catalyst_needs_onboarding";

export const ONBOARDING_STEP_LABELS = ["Subscribe", "Configure SDR", "Activate"] as const;

export type OnboardingStepIndex = 0 | 1 | 2;

export function clampOnboardingStep(value: unknown): OnboardingStepIndex {
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 2) return 2;
  return n as OnboardingStepIndex;
}

export function readStoredOnboardingStep(
  storage: { getItem(key: string): string | null } = typeof localStorage !== "undefined" ? localStorage : { getItem: () => null }
): OnboardingStepIndex {
  return clampOnboardingStep(storage.getItem(ONBOARDING_STORAGE_KEY) ?? "0");
}

export function writeStoredOnboardingStep(
  step: OnboardingStepIndex,
  storage: { setItem(key: string, value: string): void } = typeof localStorage !== "undefined" ? localStorage : { setItem: () => {} }
): void {
  storage.setItem(ONBOARDING_STORAGE_KEY, String(clampOnboardingStep(step)));
}

export function clearOnboardingStorage(
  storage: { removeItem(key: string): void } = typeof localStorage !== "undefined" ? localStorage : { removeItem: () => {} }
): void {
  storage.removeItem(ONBOARDING_STORAGE_KEY);
  storage.removeItem(ONBOARDING_FLAG_KEY);
}

/**
 * Whether the SDR onboarding wizard should be shown.
 * Admins never see it. Only users with onboardingComplete === false.
 * (Column defaults true so legacy accounts skip; register sets false.)
 */
export function shouldShowOnboarding(user: {
  role?: string | null;
  onboardingComplete?: boolean | null;
} | null | undefined): boolean {
  if (!user) return false;
  if (user.role === "admin") return false;
  return user.onboardingComplete === false;
}

/** Step 1 is done once the workspace subscription is active. */
export function isSubscribeStepComplete(billing: {
  sdr?: { isActive?: boolean } | null;
} | null | undefined): boolean {
  return !!billing?.sdr?.isActive;
}

/** Step 2 requires core SDR config fields. */
export function isConfigureStepComplete(config: {
  systemPrompt?: string | null;
  smsTemplate?: string | null;
  emailSubject?: string | null;
  emailBody?: string | null;
} | null | undefined): boolean {
  if (!config) return false;
  return !!(
    config.systemPrompt?.trim() &&
    config.smsTemplate?.trim() &&
    config.emailSubject?.trim() &&
    config.emailBody?.trim()
  );
}

/** Step 3 done when SDR agent isActive. */
export function isActivateStepComplete(config: {
  isActive?: boolean | null;
} | null | undefined): boolean {
  return !!config?.isActive;
}
