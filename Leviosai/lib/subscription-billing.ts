/**
 * Automatic commercial billing: charge each org's saved card on their
 * subscription anniversary (monthly retainer) and when appointments are booked.
 */

import { and, eq, isNotNull, or } from "drizzle-orm";
import { db } from "./db.js";
import { appointmentCharges, organizations } from "./schema.js";
import {
  ensureCommercialPricingSchema,
  ensureMonthlyRetainerCharge,
  updateChargeStatus,
} from "./commercial-pricing-service.js";
import {
  computeNextBillingAt,
  cyclePeriodKey,
  shouldChargeAppointment,
  shouldChargeMonthly,
} from "./subscription-cycle.js";
import {
  chargeCustomerOffSession,
  deactivateWorkspaceForFailedCharge,
  isStripeConfigured,
  pauseSubscriptionCollection,
  resetUsageForStripeCustomer,
  retrieveStripeSubscription,
  subscriptionPeriodEndDate,
  subscriptionPeriodStartDate,
} from "./stripe.js";

const CHARGE_RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const APPOINTMENT_BATCH = 50;

let cronRunning = false;

export async function activateOrgBillingCycle(opts: {
  organizationId: number;
  periodStart: Date;
  periodEnd: Date;
  firstChargePaid?: boolean;
}): Promise<void> {
  await ensureCommercialPricingSchema();
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, opts.organizationId))
    .limit(1);
  if (!org) return;

  const patch: Partial<typeof organizations.$inferInsert> = {
    lastBillingError: null,
  };
  if (!org.billingCycleAnchorAt) patch.billingCycleAnchorAt = opts.periodStart;
  if (!org.nextBillingAt) patch.nextBillingAt = opts.periodEnd;
  if (opts.firstChargePaid) patch.subscriptionCanceledAt = null;

  await db.update(organizations).set(patch).where(eq(organizations.id, opts.organizationId));

  const periodKey = cyclePeriodKey(opts.periodStart);
  const charge = await ensureMonthlyRetainerCharge(opts.organizationId, periodKey);
  const shouldReceipt =
    opts.firstChargePaid &&
    charge &&
    (charge.status === "pending" || charge.status === "invoiced");
  if (shouldReceipt && charge) {
    await updateChargeStatus(charge.id, "paid");
    void import("./product-email.js")
      .then(({ notifyOrgBillPaid }) =>
        notifyOrgBillPaid({
          organizationId: opts.organizationId,
          feeKind: "monthly",
          amountCents: charge.amountCents,
          description: charge.description,
          chargeId: charge.id,
        })
      )
      .catch((err: Error) => console.error("First-month receipt email failed:", err.message));
  }
}

export async function markChargePaidFromPaymentIntent(
  chargeId: number,
  paymentIntentId: string
): Promise<void> {
  await ensureCommercialPricingSchema();
  const [charge] = await db
    .select({ id: appointmentCharges.id, status: appointmentCharges.status })
    .from(appointmentCharges)
    .where(eq(appointmentCharges.id, chargeId))
    .limit(1);
  if (!charge || charge.status === "paid" || charge.status === "waived") return;
  await updateChargeStatus(chargeId, "paid", { stripePaymentIntentId: paymentIntentId });
}

export async function markMonthlyPaidFromStripeInvoice(
  stripeCustomerId: string,
  invoice: { period_start?: number | null; created?: number | null }
): Promise<void> {
  await ensureCommercialPricingSchema();
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.stripeCustomerId, stripeCustomerId))
    .limit(1);
  if (!org) return;

  const unix = invoice.period_start || invoice.created;
  const periodStart = unix
    ? new Date(unix * 1000)
    : org.billingCycleAnchorAt || org.nextBillingAt || new Date();
  const charge = await ensureMonthlyRetainerCharge(org.id, cyclePeriodKey(periodStart));
  if (charge && charge.status !== "paid" && charge.status !== "waived") {
    await updateChargeStatus(charge.id, "paid");
  }
}

export async function collectChargeFromCard(
  chargeId: number,
  now = new Date()
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  await ensureCommercialPricingSchema();
  if (!isStripeConfigured()) return { ok: false, skipped: "stripe_unconfigured" };

  const [charge] = await db
    .select()
    .from(appointmentCharges)
    .where(eq(appointmentCharges.id, chargeId))
    .limit(1);
  if (!charge) return { ok: false, skipped: "missing" };
  if (charge.status === "paid" || charge.status === "waived") {
    return { ok: true, skipped: charge.status };
  }
  if (charge.amountCents <= 0) {
    await updateChargeStatus(chargeId, "paid");
    return { ok: true, skipped: "zero" };
  }
  if (
    charge.lastChargeAttemptAt &&
    now.getTime() - new Date(charge.lastChargeAttemptAt).getTime() < CHARGE_RETRY_COOLDOWN_MS
  ) {
    return { ok: false, skipped: "cooldown" };
  }

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, charge.organizationId))
    .limit(1);
  if (!org?.stripeCustomerId) {
    await db
      .update(appointmentCharges)
      .set({ lastChargeError: "No card on file", lastChargeAttemptAt: now })
      .where(eq(appointmentCharges.id, chargeId));
    return { ok: false, skipped: "no_customer" };
  }

  if (charge.feeKind === "appointment") {
    const decision = shouldChargeAppointment({
      stripeCustomerId: org.stripeCustomerId,
      subscriptionCanceledAt: org.subscriptionCanceledAt,
      stripeSubscriptionId: org.stripeSubscriptionId,
    });
    if (!decision.due) {
      return { ok: false, skipped: decision.reason };
    }
  } else if (charge.feeKind === "monthly" && org.subscriptionCanceledAt) {
    return { ok: false, skipped: "canceled" };
  }

  await db
    .update(appointmentCharges)
    .set({ lastChargeAttemptAt: now })
    .where(eq(appointmentCharges.id, chargeId));

  try {
    const result = await chargeCustomerOffSession({
      customerId: org.stripeCustomerId,
      amountCents: charge.amountCents,
      description: charge.description || `${charge.feeKind} #${charge.id}`,
      idempotencyKey: `levios-charge-${charge.id}`,
      metadata: {
        organizationId: String(org.id),
        chargeId: String(charge.id),
        feeKind: charge.feeKind,
      },
    });
    await updateChargeStatus(charge.id, "paid", {
      stripePaymentIntentId: result.paymentIntentId,
      lastChargeError: null,
    });
    await db
      .update(organizations)
      .set({ lastBillingError: null })
      .where(eq(organizations.id, org.id));
    void import("./product-email.js")
      .then(({ notifyOrgBillPaid }) =>
        notifyOrgBillPaid({
          organizationId: org.id,
          feeKind: charge.feeKind,
          amountCents: charge.amountCents,
          description: charge.description,
          chargeId: charge.id,
        })
      )
      .catch((err: Error) => console.error("Bill receipt email failed:", err.message));
    return { ok: true };
  } catch (err: any) {
    const message = err?.message || String(err);
    await db
      .update(appointmentCharges)
      .set({ lastChargeError: message, lastChargeAttemptAt: now })
      .where(eq(appointmentCharges.id, chargeId));
    await db
      .update(organizations)
      .set({ lastBillingError: message })
      .where(eq(organizations.id, org.id));
    if (charge.feeKind === "monthly") {
      await deactivateWorkspaceForFailedCharge(org.stripeCustomerId);
    }
    void import("./product-email.js")
      .then(({ notifyOrgPaymentFailed }) =>
        notifyOrgPaymentFailed({
          organizationId: org.id,
          amountCents: charge.amountCents,
          errorMessage: message,
        })
      )
      .catch((err: Error) => console.error("Payment failed email failed:", err.message));
    return { ok: false, error: message };
  }
}

async function advanceNextBilling(
  org: typeof organizations.$inferSelect,
  now: Date
): Promise<Date> {
  const anchor = org.billingCycleAnchorAt || org.nextBillingAt || now;
  const next = computeNextBillingAt(anchor, now);
  await db
    .update(organizations)
    .set({ nextBillingAt: next, lastBillingError: null })
    .where(eq(organizations.id, org.id));
  return next;
}

async function backfillBillingCycleFromStripe(
  org: typeof organizations.$inferSelect
): Promise<typeof organizations.$inferSelect | null> {
  if (!org.stripeSubscriptionId) return org;
  try {
    const sub = await retrieveStripeSubscription(org.stripeSubscriptionId);
    if (!sub) return org;
    const periodStart = subscriptionPeriodStartDate(sub) || org.createdAt || new Date();
    const periodEnd = subscriptionPeriodEndDate(sub);
    if (!periodEnd) return org;
    await db
      .update(organizations)
      .set({
        billingCycleAnchorAt: org.billingCycleAnchorAt || periodStart,
        nextBillingAt: periodEnd,
      })
      .where(eq(organizations.id, org.id));
    await pauseSubscriptionCollection(sub.id);
    return {
      ...org,
      billingCycleAnchorAt: org.billingCycleAnchorAt || periodStart,
      nextBillingAt: periodEnd,
    };
  } catch (err: any) {
    console.warn(`Billing cycle backfill failed for org ${org.id}:`, err?.message || err);
    return org;
  }
}

export async function runDueMonthlyCharges(now = new Date()): Promise<{
  scanned: number;
  charged: number;
  skipped: number;
  failed: number;
}> {
  await ensureCommercialPricingSchema();
  const orgs = await db
    .select()
    .from(organizations)
    .where(isNotNull(organizations.stripeCustomerId));

  let charged = 0;
  let skipped = 0;
  let failed = 0;

  for (let org of orgs) {
    if (!org.nextBillingAt && org.stripeSubscriptionId) {
      org = (await backfillBillingCycleFromStripe(org)) || org;
    }
    const decision = shouldChargeMonthly({
      now,
      nextBillingAt: org.nextBillingAt,
      stripeCustomerId: org.stripeCustomerId,
      stripeSubscriptionId: org.stripeSubscriptionId,
      subscriptionCanceledAt: org.subscriptionCanceledAt,
    });
    if (!decision.due) {
      skipped += 1;
      continue;
    }

    const periodKey = cyclePeriodKey(org.nextBillingAt!);
    const charge = await ensureMonthlyRetainerCharge(org.id, periodKey);
    if (!charge) {
      await advanceNextBilling(org, now);
      skipped += 1;
      continue;
    }
    const result = await collectChargeFromCard(charge.id, now);
    if (result.ok) {
      await advanceNextBilling(org, now);
      if (org.stripeCustomerId) {
        await resetUsageForStripeCustomer(org.stripeCustomerId);
      }
      charged += 1;
    } else if (result.skipped === "cooldown") {
      skipped += 1;
    } else {
      failed += 1;
    }
  }

  return { scanned: orgs.length, charged, skipped, failed };
}

export async function runPendingAppointmentCharges(now = new Date()): Promise<{
  scanned: number;
  charged: number;
  failed: number;
}> {
  await ensureCommercialPricingSchema();
  const rows = await db
    .select()
    .from(appointmentCharges)
    .where(
      and(
        eq(appointmentCharges.feeKind, "appointment"),
        or(
          eq(appointmentCharges.status, "pending"),
          eq(appointmentCharges.status, "invoiced")
        )
      )
    )
    .limit(APPOINTMENT_BATCH);

  let charged = 0;
  let failed = 0;
  for (const row of rows) {
    const result = await collectChargeFromCard(row.id, now);
    if (result.ok) charged += 1;
    else if (!result.skipped) failed += 1;
  }
  return { scanned: rows.length, charged, failed };
}

export async function runSubscriptionBillingCron(now = new Date()): Promise<{
  skipped?: boolean;
  monthly?: Awaited<ReturnType<typeof runDueMonthlyCharges>>;
  appointments?: Awaited<ReturnType<typeof runPendingAppointmentCharges>>;
}> {
  if (cronRunning) return { skipped: true };
  cronRunning = true;
  try {
    const monthly = await runDueMonthlyCharges(now);
    const appointments = await runPendingAppointmentCharges(now);
    if (monthly.charged || monthly.failed || appointments.charged || appointments.failed) {
      console.log(
        `💳 Billing cron: monthly ${monthly.charged} charged / ${monthly.failed} failed, appointments ${appointments.charged} charged / ${appointments.failed} failed`
      );
    }
    return { monthly, appointments };
  } catch (err: any) {
    console.error("Billing cron failed:", err?.message || err);
    return { skipped: true };
  } finally {
    cronRunning = false;
  }
}

export function startSubscriptionBillingCron(): void {
  const intervalMs = Number(process.env.BILLING_CRON_MS || 60 * 60 * 1000);
  const delayMs = Number(process.env.BILLING_CRON_START_DELAY_MS || 20_000);
  setTimeout(() => {
    void runSubscriptionBillingCron();
  }, delayMs);
  setInterval(() => {
    void runSubscriptionBillingCron();
  }, Number.isFinite(intervalMs) && intervalMs >= 60_000 ? intervalMs : 60 * 60 * 1000);
  console.log(
    `✅ Subscription billing cron every ${Math.round((Number.isFinite(intervalMs) && intervalMs >= 60_000 ? intervalMs : 3_600_000) / 60000)} minutes (per-user anniversary)`
  );
}
