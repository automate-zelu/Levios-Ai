/**
 * Test-safe email delivery rules.
 *
 * - NODE_ENV=test → do not send unless EMAIL_TEST_ALLOW_SEND=1
 * - When sending in tests (or EMAIL_TEST_REDIRECT_TO is set with allow),
 *   only deliver to EMAIL_TEST_REDIRECT_TO (default btwimawais@gmail.com).
 */

export const DEFAULT_TEST_EMAIL_REDIRECT = "btwimawais@gmail.com";

export type EmailDeliveryPlan = {
  /** Final To: list (may be empty when skipped) */
  recipients: string[];
  /** True when we intentionally do not call the provider */
  skipped: boolean;
  /** True when original recipients were rewritten */
  redirected: boolean;
  reason: "send" | "test_skip" | "redirect";
};

export function resolveEmailDelivery(to: string | string[]): EmailDeliveryPlan {
  const original = (Array.isArray(to) ? to : [to])
    .map((e) => String(e || "").trim().toLowerCase())
    .filter(Boolean);

  const redirect = (
    process.env.EMAIL_TEST_REDIRECT_TO ||
    DEFAULT_TEST_EMAIL_REDIRECT
  )
    .trim()
    .toLowerCase();

  const isTestEnv = process.env.NODE_ENV === "test";
  const allowSend = process.env.EMAIL_TEST_ALLOW_SEND === "1";

  // Automated tests: never hit Resend unless explicitly allowed
  if (isTestEnv && !allowSend) {
    return { recipients: [], skipped: true, redirected: false, reason: "test_skip" };
  }

  // Allowed test sends (or forced redirect) go only to the safe inbox
  if (isTestEnv && allowSend) {
    return {
      recipients: redirect ? [redirect] : [],
      skipped: !redirect,
      redirected: true,
      reason: redirect ? "redirect" : "test_skip",
    };
  }

  // Optional: redirect all mail when EMAIL_FORCE_TEST_REDIRECT=1 (manual break tests)
  if (process.env.EMAIL_FORCE_TEST_REDIRECT === "1" && redirect) {
    return {
      recipients: [redirect],
      skipped: false,
      redirected: true,
      reason: "redirect",
    };
  }

  return {
    recipients: original,
    skipped: original.length === 0,
    redirected: false,
    reason: original.length ? "send" : "test_skip",
  };
}
