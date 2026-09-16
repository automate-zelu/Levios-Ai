/**
 * Per-org subscription billing dates.
 * Each customer is charged on their own anniversary (the day they subscribed),
 * not on a single platform-wide calendar day.
 */

export function utcYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** YYYY-MM-DD for a billing cycle starting on `date`. */
export function cyclePeriodKey(date: Date): string {
  return utcYmd(date);
}

export function parsePeriodKey(period: string): Date | null {
  const m = String(period || "").trim().match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!m) return null;
  const y = Number(m[1]);
  const month = Number(m[2]);
  const day = m[3] ? Number(m[3]) : 1;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(y, month - 1, day, 0, 0, 0, 0));
}

export function formatCycleLabel(period: string): string {
  const d = parsePeriodKey(period);
  if (!d) return period;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: period.length > 7 ? "numeric" : undefined,
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Add calendar months in UTC, clamping the day (Jan 31 → Feb 28). */
export function addCalendarMonthsUtc(anchor: Date, months: number): Date {
  const year = anchor.getUTCFullYear();
  const monthIndex = anchor.getUTCMonth() + months;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(anchor.getUTCDate(), lastDay);
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      day,
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds()
    )
  );
}

/**
 * Next charge instant strictly after `after`, walking forward from `anchor`
 * in 1-month steps (same day-of-month, clamped).
 */
export function computeNextBillingAt(anchor: Date, after: Date): Date {
  if (after.getTime() < anchor.getTime()) return new Date(anchor.getTime());
  let n = 1;
  let next = addCalendarMonthsUtc(anchor, n);
  while (next.getTime() <= after.getTime()) {
    n += 1;
    if (n > 240) return addCalendarMonthsUtc(after, 1);
    next = addCalendarMonthsUtc(anchor, n);
  }
  return next;
}

export function isBillingDue(nextBillingAt: Date | null | undefined, now: Date): boolean {
  if (!nextBillingAt) return false;
  return nextBillingAt.getTime() <= now.getTime();
}

export function shouldChargeMonthly(input: {
  now: Date;
  nextBillingAt: Date | null | undefined;
  stripeCustomerId: string | null | undefined;
  stripeSubscriptionId: string | null | undefined;
  subscriptionCanceledAt: Date | null | undefined;
}): { due: boolean; reason: string } {
  if (!input.stripeCustomerId) return { due: false, reason: "no_card" };
  if (!input.stripeSubscriptionId) return { due: false, reason: "no_subscription" };
  if (input.subscriptionCanceledAt) return { due: false, reason: "canceled" };
  if (!input.nextBillingAt) return { due: false, reason: "no_cycle" };
  if (!isBillingDue(input.nextBillingAt, input.now)) return { due: false, reason: "not_due" };
  return { due: true, reason: "due" };
}

/**
 * Per-appointment fees still bill to the saved card after the user cancels
 * monthly auto-renew (and after the Stripe subscription row is cleared).
 */
export function shouldChargeAppointment(input: {
  stripeCustomerId: string | null | undefined;
  subscriptionCanceledAt?: Date | null | undefined;
  stripeSubscriptionId?: string | null | undefined;
}): { due: boolean; reason: string } {
  // Cancel / missing Stripe subscription must not block appointment fees.
  void input.subscriptionCanceledAt;
  void input.stripeSubscriptionId;
  if (!input.stripeCustomerId) return { due: false, reason: "no_card" };
  return { due: true, reason: "appointment_fee" };
}
