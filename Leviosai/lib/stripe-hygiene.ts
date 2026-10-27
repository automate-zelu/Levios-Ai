/**
 * Stripe ID hygiene — stale customers/subs (deleted, wrong mode) must not 500 Billing.
 */

import { eq } from "drizzle-orm";
import { db } from "./db.js";
import { organizations } from "./schema.js";
import { clearPausePatch } from "./billing-pause.js";

export function isStripeMissingResourceError(err: unknown): boolean {
  const anyErr = err as { code?: string; message?: string; type?: string } | null;
  const msg = String(anyErr?.message || err || "");
  if (/no such customer/i.test(msg)) return true;
  if (/no such subscription/i.test(msg)) return true;
  if (anyErr?.code === "resource_missing") return true;
  return false;
}

export async function clearOrgStripeBillingIds(
  organizationId: number,
  opts: { clearPause?: boolean } = {}
): Promise<void> {
  const patch: Record<string, unknown> = {
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    lastBillingError: null,
  };
  if (opts.clearPause) {
    Object.assign(patch, clearPausePatch());
  }
  await db.update(organizations).set(patch as any).where(eq(organizations.id, organizationId));
}

/** Returns true if the customer exists and is not deleted. */
export async function stripeCustomerExists(customerId: string): Promise<boolean> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !customerId) return false;
  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(key);
    const customer = await stripe.customers.retrieve(customerId);
    return !(customer as { deleted?: boolean }).deleted;
  } catch (err) {
    if (isStripeMissingResourceError(err)) return false;
    throw err;
  }
}

/** Returns true if the subscription exists. */
export async function stripeSubscriptionExists(subscriptionId: string): Promise<boolean> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !subscriptionId) return false;
  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(key);
    await stripe.subscriptions.retrieve(subscriptionId);
    return true;
  } catch (err) {
    if (isStripeMissingResourceError(err)) return false;
    throw err;
  }
}

/**
 * Ensure org has a live Stripe customer id for checkout.
 * Recreates when the stored id is missing in Stripe.
 */
export async function ensureLiveStripeCustomerId(opts: {
  organizationId: number;
  email: string;
  organizationName: string;
  currentCustomerId?: string | null;
  createCustomer: (
    orgId: number,
    email: string,
    orgName: string
  ) => Promise<{ id: string } | null>;
}): Promise<{ customerId: string; recreated: boolean }> {
  let customerId = opts.currentCustomerId || null;
  let recreated = false;

  if (customerId) {
    const ok = await stripeCustomerExists(customerId);
    if (!ok) {
      await clearOrgStripeBillingIds(opts.organizationId, { clearPause: true });
      customerId = null;
      recreated = true;
    }
  }

  if (!customerId) {
    const customer = await opts.createCustomer(
      opts.organizationId,
      opts.email,
      opts.organizationName
    );
    if (!customer?.id) throw new Error("Failed to create Stripe customer");
    customerId = customer.id;
    recreated = true;
  }

  return { customerId, recreated };
}
