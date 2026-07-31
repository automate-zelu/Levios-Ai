import Stripe from "stripe";
import { db } from "./db.js";
import { organizations, workspaces } from "./schema.js";
import { eq } from "drizzle-orm";
import {
  setWorkspaceActive,
  changeWorkspaceTier,
  resetWorkspaceUsage,
} from "./sdr-admin.js";
import { planKeyToSdrTier, TIER_LIMITS, type SdrTier } from "./tiers.js";
import { provisionWorkspace } from "./twilio-subaccount.js";
import { notifyTwilioProvisionFailed } from "./ops-alerts.js";
import {
  PLAN_PRICING,
  resolveStripePriceId,
  isPaidPlanKey,
} from "./pricing.js";

async function activateWorkspaceForOrg(orgId: number, plan: string): Promise<void> {
  const tier = planKeyToSdrTier(plan);
  const isActive = plan !== "free";

  const [ws] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      twilioSubAccountSid: workspaces.twilioSubAccountSid,
    })
    .from(workspaces)
    .where(eq(workspaces.organizationId, orgId))
    .limit(1);

  if (!ws) return; // workspace not yet created — admin will provision manually

  try {
    await changeWorkspaceTier(ws.id, tier);
    await setWorkspaceActive(ws.id, isActive);
    console.log(`✅ Workspace ${ws.id} ${isActive ? "activated" : "deactivated"} (tier: ${tier}) for org ${orgId}`);
  } catch (err: any) {
    console.error(`⚠️  Failed to activate workspace for org ${orgId}:`, err.message);
    return;
  }

  // Auto-provision Twilio sub-account on paid activation (plan §16.8).
  // Non-fatal — admin can provision manually; ops gets an email on failure.
  if (isActive && !ws.twilioSubAccountSid) {
    try {
      await provisionWorkspace(ws.id, ws.name);
      console.log(`✅ Twilio provisioned for workspace ${ws.id}`);
    } catch (err: any) {
      console.error(`⚠️ Twilio provisioning failed for ${ws.id}:`, err.message);
      await notifyTwilioProvisionFailed({
        workspaceId: ws.id,
        workspaceName: ws.name,
        organizationId: orgId,
        errorMessage: err?.message || String(err),
      });
    }
  }
}

async function deactivateWorkspaceForCustomer(stripeCustomerId: string): Promise<void> {
  const [ws] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.stripeCustomerId, stripeCustomerId))
    .limit(1);

  if (!ws) {
    // Try via org
    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.stripeCustomerId, stripeCustomerId))
      .limit(1);
    if (!org) return;
    const [orgWs] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.organizationId, org.id))
      .limit(1);
    if (!orgWs) return;
    await setWorkspaceActive(orgWs.id, false);
    return;
  }
  await setWorkspaceActive(ws.id, false);
}

async function resetUsageForCustomer(stripeCustomerId: string): Promise<void> {
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.stripeCustomerId, stripeCustomerId))
    .limit(1);
  if (!org) return;

  const [ws] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.organizationId, org.id))
    .limit(1);
  if (!ws) return;

  await resetWorkspaceUsage(ws.id);
  console.log(`✅ Monthly usage reset for workspace ${ws.id} (org ${org.id})`);
}

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

export function isStripeConfigured() {
  return !!stripe;
}

// Plan definitions — prices from lib/pricing.ts (IMPLEMENTATION_PLAN §15 / §21.3).
// Stripe Price IDs come from env (create via `npm run stripe:sync-prices`).
export const PLANS = {
  free: {
    name: "Free",
    sdrTier: "starter" as SdrTier,
    leadsLimit: 0,
    minutesLimit: 0,
    seatLimit: 1,
    messagesPerMonth: 50,
    aiScoresPerMonth: 10,
    monthlyPriceCents: null as number | null,
    priceHint: "Subscribe to activate SDR",
    priceId: null as string | null,
  },
  starter: {
    name: PLAN_PRICING.starter.name,
    sdrTier: "starter" as SdrTier,
    leadsLimit: TIER_LIMITS.starter.monthlyLeadLimit,
    minutesLimit: TIER_LIMITS.starter.monthlyMinuteLimit,
    seatLimit: TIER_LIMITS.starter.seatLimit,
    messagesPerMonth: 500,
    aiScoresPerMonth: 100,
    monthlyPriceCents: PLAN_PRICING.starter.monthlyPriceCents,
    priceHint: PLAN_PRICING.starter.priceHint,
    priceId: resolveStripePriceId("starter"),
  },
  growth: {
    name: PLAN_PRICING.growth.name,
    sdrTier: "growth" as SdrTier,
    leadsLimit: TIER_LIMITS.growth.monthlyLeadLimit,
    minutesLimit: TIER_LIMITS.growth.monthlyMinuteLimit,
    seatLimit: TIER_LIMITS.growth.seatLimit,
    messagesPerMonth: 2000,
    aiScoresPerMonth: 500,
    monthlyPriceCents: PLAN_PRICING.growth.monthlyPriceCents,
    priceHint: PLAN_PRICING.growth.priceHint,
    priceId: resolveStripePriceId("growth"),
  },
  /** @deprecated alias for growth — kept for existing Stripe price metadata */
  pro: {
    name: "Pro",
    sdrTier: "growth" as SdrTier,
    leadsLimit: TIER_LIMITS.growth.monthlyLeadLimit,
    minutesLimit: TIER_LIMITS.growth.monthlyMinuteLimit,
    seatLimit: TIER_LIMITS.growth.seatLimit,
    messagesPerMonth: 1000,
    aiScoresPerMonth: 200,
    monthlyPriceCents: PLAN_PRICING.growth.monthlyPriceCents,
    priceHint: PLAN_PRICING.growth.priceHint,
    priceId: resolveStripePriceId("growth"),
  },
  scale: {
    name: PLAN_PRICING.scale.name,
    sdrTier: "scale" as SdrTier,
    leadsLimit: TIER_LIMITS.scale.monthlyLeadLimit,
    minutesLimit: TIER_LIMITS.scale.monthlyMinuteLimit,
    seatLimit: TIER_LIMITS.scale.seatLimit,
    messagesPerMonth: 5000,
    aiScoresPerMonth: 2000,
    monthlyPriceCents: PLAN_PRICING.scale.monthlyPriceCents,
    priceHint: PLAN_PRICING.scale.priceHint,
    priceId: resolveStripePriceId("scale"),
  },
  enterprise: {
    name: PLAN_PRICING.enterprise.name,
    sdrTier: "enterprise" as SdrTier,
    leadsLimit: TIER_LIMITS.enterprise.monthlyLeadLimit,
    minutesLimit: TIER_LIMITS.enterprise.monthlyMinuteLimit,
    seatLimit: TIER_LIMITS.enterprise.seatLimit,
    messagesPerMonth: -1,
    aiScoresPerMonth: -1,
    monthlyPriceCents: PLAN_PRICING.enterprise.monthlyPriceCents,
    priceHint: PLAN_PRICING.enterprise.priceHint,
    priceId: resolveStripePriceId("enterprise"),
  },
} as const;

export type PlanKey = keyof typeof PLANS;

function planKeyFromPriceId(priceId: string | undefined | null): string {
  if (!priceId) return "starter";
  const hit = Object.entries(PLANS).find(
    ([key, p]) => key !== "pro" && p.priceId && p.priceId === priceId
  );
  return hit?.[0] || "growth";
}

// Create a Stripe customer for an organization
export async function createStripeCustomer(orgId: number, email: string, orgName: string) {
  if (!stripe) return null;

  const customer = await stripe.customers.create({
    email,
    name: orgName,
    metadata: { organizationId: String(orgId) },
  });

  await db
    .update(organizations)
    .set({ stripeCustomerId: customer.id })
    .where(eq(organizations.id, orgId));

  return customer;
}

// Create a checkout session for upgrading
export async function createCheckoutSession(
  orgId: number,
  stripeCustomerId: string,
  priceId: string,
  successUrl: string,
  cancelUrl: string,
  planKey?: string
) {
  if (!stripe) throw new Error("Stripe not configured");

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      organizationId: String(orgId),
      ...(planKey ? { planKey } : {}),
    },
    subscription_data: planKey
      ? { metadata: { planKey, organizationId: String(orgId) } }
      : undefined,
  });

  return session;
}

// Create a billing portal session (manage subscription)
export async function createPortalSession(stripeCustomerId: string, returnUrl: string) {
  if (!stripe) throw new Error("Stripe not configured");

  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  });

  return session;
}

// Handle Stripe webhook events
export async function handleWebhookEvent(payload: Buffer, signature: string) {
  if (!stripe) throw new Error("Stripe not configured");

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET not set");

  const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orgId = parseInt(session.metadata?.organizationId || "0");
      if (orgId && session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
        const priceId = subscription.items.data[0]?.price.id;
        const plan =
          session.metadata?.planKey ||
          subscription.metadata?.planKey ||
          planKeyFromPriceId(priceId);

        await db
          .update(organizations)
          .set({ stripeSubscriptionId: subscription.id, stripePriceId: priceId, plan })
          .where(eq(organizations.id, orgId));

        // Activate workspace SDR with correct tier limits
        await activateWorkspaceForOrg(orgId, plan);
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      const priceId = subscription.items.data[0]?.price.id;
      const plan = subscription.metadata?.planKey || planKeyFromPriceId(priceId);

      // Keep plan + access while cancel_at_period_end is true (auto-renew off until period ends).
      // Only fully remove on customer.subscription.deleted.
      const [updatedOrg] = await db
        .update(organizations)
        .set({ stripeSubscriptionId: subscription.id, stripePriceId: priceId, plan })
        .where(eq(organizations.stripeCustomerId, customerId))
        .returning({ id: organizations.id });

      if (updatedOrg) {
        const paidActive =
          subscription.status === "active" || subscription.status === "trialing";
        if (paidActive) {
          await activateWorkspaceForOrg(updatedOrg.id, plan);
        }
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      await db
        .update(organizations)
        .set({ stripeSubscriptionId: null, stripePriceId: null, plan: "free" })
        .where(eq(organizations.stripeCustomerId, customerId));

      // Deactivate workspace SDR — no active subscription
      await deactivateWorkspaceForCustomer(customerId);
      break;
    }

    case "invoice.paid": {
      // Subscription renewed — reset monthly usage counters
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;
      if (customerId) {
        await resetUsageForCustomer(customerId);
      }
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;
      console.warn(`⚠️  Payment failed for customer ${customerId}`);
      // Deactivate SDR until payment is resolved
      await deactivateWorkspaceForCustomer(customerId);
      break;
    }
  }

  return { received: true, type: event.type };
}

/** Stripe Basil+: period lives on subscription items, not the subscription root. */
function subscriptionPeriodEndUnix(subscription: Stripe.Subscription): number | null {
  const fromItem = subscription.items?.data?.[0]?.current_period_end;
  if (typeof fromItem === "number") return fromItem;
  if (typeof subscription.cancel_at === "number") return subscription.cancel_at;
  return null;
}

function serializeSubscriptionStatus(subscription: Stripe.Subscription) {
  const endUnix = subscriptionPeriodEndUnix(subscription);
  return {
    status: subscription.status,
    currentPeriodEnd: endUnix ? new Date(endUnix * 1000) : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    /** Stripe subscriptions auto-renew unless cancel_at_period_end is set */
    autoRenew: subscription.status === "active" && !subscription.cancel_at_period_end,
  };
}

// Get subscription status for an org
export async function getSubscriptionStatus(stripeSubscriptionId: string) {
  if (!stripe) return null;
  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  return serializeSubscriptionStatus(subscription);
}

/**
 * Turn auto-renew off (access until period end) or back on.
 * Does not immediately cancel — Stripe ends the sub when the period ends if cancelAtPeriodEnd is true.
 */
export async function setSubscriptionAutoRenew(
  stripeSubscriptionId: string,
  autoRenew: boolean
) {
  if (!stripe) throw new Error("Stripe not configured");
  const subscription = await stripe.subscriptions.update(stripeSubscriptionId, {
    cancel_at_period_end: !autoRenew,
  });
  return serializeSubscriptionStatus(subscription);
}
