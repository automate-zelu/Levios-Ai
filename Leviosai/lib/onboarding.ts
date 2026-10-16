// ─── LEVVI ONBOARDING HELPERS (P4) ───────────────────────────────────────────
// Knowledge is skippable; Launch requires paid billing (no free / limited unpaid tier).

export const ONBOARDING_STORAGE_KEY = "catalyst_onboarding_step";
export const ONBOARDING_FLAG_KEY = "catalyst_needs_onboarding";
export const ONBOARDING_DRAFT_KEY = "catalyst_onboarding_draft";

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
] as const;

export const LEVVI_STEP_COUNT = ONBOARDING_STEP_LABELS.length;
export const LEVVI_LAST_STEP = LEVVI_STEP_COUNT - 1;
export const LEVVI_KB_STEP = 7;
export const LEVVI_LAUNCH_STEP = 8;

export type OnboardingStepIndex = number;

export function clampOnboardingStep(value: unknown): number {
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > LEVVI_LAST_STEP) return LEVVI_LAST_STEP;
  return n;
}

export function readStoredOnboardingStep(
  storage: { getItem(key: string): string | null } = typeof localStorage !== "undefined" ? localStorage : { getItem: () => null }
): number {
  return clampOnboardingStep(storage.getItem(ONBOARDING_STORAGE_KEY) ?? "0");
}

export function writeStoredOnboardingStep(
  step: number,
  storage: { setItem(key: string, value: string): void } = typeof localStorage !== "undefined" ? localStorage : { setItem: () => {} }
): void {
  storage.setItem(ONBOARDING_STORAGE_KEY, String(clampOnboardingStep(step)));
}

export function clearOnboardingStorage(
  storage: { removeItem(key: string): void } = typeof localStorage !== "undefined" ? localStorage : { removeItem: () => {} }
): void {
  storage.removeItem(ONBOARDING_STORAGE_KEY);
  storage.removeItem(ONBOARDING_FLAG_KEY);
  storage.removeItem(ONBOARDING_DRAFT_KEY);
}

export function readOnboardingDraft(
  storage: { getItem(key: string): string | null } = typeof localStorage !== "undefined" ? localStorage : { getItem: () => null }
): Record<string, unknown> {
  try {
    const raw = storage.getItem(ONBOARDING_DRAFT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeOnboardingDraft(
  draft: Record<string, unknown>,
  storage: { setItem(key: string, value: string): void } = typeof localStorage !== "undefined" ? localStorage : { setItem: () => {} }
): void {
  storage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(draft || {}));
}

export function shouldShowOnboarding(user: {
  role?: string | null;
  onboardingComplete?: boolean | null;
} | null | undefined): boolean {
  if (!user) return false;
  if (user.role === "admin") return false;
  return user.onboardingComplete === false;
}

export function isSubscribeStepComplete(billing: {
  sdr?: { isActive?: boolean } | null;
} | null | undefined): boolean {
  return !!billing?.sdr?.isActive;
}

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

export function isActivateStepComplete(config: {
  isActive?: boolean | null;
} | null | undefined): boolean {
  return !!config?.isActive;
}

export function isBusinessDraftComplete(draft: {
  companyName?: string | null;
  industry?: string | null;
} | null | undefined): boolean {
  return !!(draft?.companyName?.trim() && draft?.industry?.trim());
}

export function isAvailabilityDraftComplete(draft: {
  timezone?: string | null;
  weekdayStart?: string | null;
  weekdayEnd?: string | null;
} | null | undefined): boolean {
  return !!(draft?.timezone?.trim() && draft?.weekdayStart && draft?.weekdayEnd);
}

export function isKbStepComplete(config: {
  knowledgeBase?: string | null;
} | null | undefined): boolean {
  return !!(config?.knowledgeBase && String(config.knowledgeBase).trim().length >= 40);
}

export function isBillingActive(billing: {
  sdr?: { isActive?: boolean } | null;
} | null | undefined): boolean {
  return !!billing?.sdr?.isActive;
}

export function firstIncompleteLevviStep(input: {
  draft?: Record<string, unknown>;
  billing?: { sdr?: { isActive?: boolean } | null } | null;
  config?: {
    systemPrompt?: string | null;
    smsTemplate?: string | null;
    emailSubject?: string | null;
    emailBody?: string | null;
    knowledgeBase?: string | null;
    isActive?: boolean | null;
  } | null;
  leadCount?: number;
} = {}): number {
  const draft = input.draft || {};
  const config = input.config || null;
  const billing = input.billing || null;
  const leadCount = input.leadCount || 0;

  if (!isBusinessDraftComplete(draft as { companyName?: string; industry?: string })) return 2;
  if (!isAvailabilityDraftComplete(draft as { timezone?: string; weekdayStart?: string; weekdayEnd?: string })) return 3;
  if (leadCount <= 0 && !draft.leadsSkipped) return 5;
  if (!isConfigureStepComplete(config)) return 6;
  if (!isKbStepComplete(config) && !draft.kbSkipped) return LEVVI_KB_STEP;
  if (!isBillingActive(billing)) return LEVVI_LAUNCH_STEP;
  return LEVVI_LAUNCH_STEP;
}
