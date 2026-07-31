import { Router, Request, Response } from "express";
import { requireAuth } from "./auth.js";
import { storage } from "../lib/storage.js";
import { db } from "../lib/db.js";
import { workspaces } from "../lib/schema.js";
import { eq } from "drizzle-orm";
import {
  isStripeConfigured,
  createStripeCustomer,
  createCheckoutSession,
  createPortalSession,
  getSubscriptionStatus,
  setSubscriptionAutoRenew,
  handleWebhookEvent,
  PLANS,
} from "../lib/stripe.js";
import { getTierLimits, planKeyToSdrTier, isUnlimited } from "../lib/tiers.js";
import { listPublicPlans, isPaidPlanKey, resolveStripePriceId } from "../lib/pricing.js";
import { formatMonthlyPriceLabel } from "../lib/pricing.js";

const router = Router();

// Get current billing status + live SDR usage
router.get("/api/billing", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.organizationId) return res.status(400).json({ error: "No organization" });
    const org = await storage.getOrganization(req.organizationId);
    if (!org) return res.status(404).json({ error: "Organization not found" });

    let subscription = null;
    if (org.stripeSubscriptionId) {
      subscription = await getSubscriptionStatus(org.stripeSubscriptionId);
    }

    const planKey = (org.plan || "free") as keyof typeof PLANS;
    const planDetails = PLANS[planKey] || PLANS.free;
    const priceLabel =
      planDetails.monthlyPriceCents != null
        ? formatMonthlyPriceLabel(planDetails.monthlyPriceCents)
        : null;

    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.organizationId, req.organizationId))
      .limit(1);

    const sdrTier = workspace?.tier || planKeyToSdrTier(planKey);
    const tierMeta = getTierLimits(sdrTier);

    res.json({
      plan: planKey,
      planDetails: {
        ...planDetails,
        priceId: planDetails.priceId ? "configured" : null,
        monthlyPriceLabel: priceLabel,
      },
      subscription,
      stripeConfigured: isStripeConfigured(),
      pricingModel: "flat_monthly_subscription",
      sdr: workspace
        ? {
            tier: workspace.tier,
            tierLabel: tierMeta.label,
            isActive: workspace.isActive,
            priceHint: tierMeta.priceHint,
            usage: {
              tier: workspace.tier,
              leadsUsed: workspace.monthlyLeadsUsed,
              leadsLimit: workspace.monthlyLeadLimit,
              minutesUsed: workspace.monthlyMinutesUsed,
              minutesLimit: workspace.monthlyMinuteLimit,
              seatLimit: workspace.seatLimit,
              leadsUnlimited: isUnlimited(workspace.monthlyLeadLimit),
              minutesUnlimited: isUnlimited(workspace.monthlyMinuteLimit),
            },
          }
        : null,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Save payment method metadata (demo — real card tokenization goes through Stripe Elements)
// Stores last4/brand/exp for UI display only. Real PCI data never touches our server.
router.post("/api/billing/payment-method", requireAuth, async (req: Request, res: Response) => {
  try {
    const { last4, brand, expMonth, expYear } = req.body || {};
    if (!last4 || !brand) return res.status(400).json({ error: "last4 and brand required" });
    // For now we just echo back — in prod this would create a Stripe SetupIntent
    // and save the payment_method_id against the org's Stripe customer.
    res.json({
      ok: true,
      last4: String(last4).slice(-4),
      brand,
      expMonth: Number(expMonth) || null,
      expYear: Number(expYear) || null,
      message: "Payment method updated (demo mode — wire Stripe Elements for live card capture)",
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get available plans (IMPLEMENTATION_PLAN §15 / §21.3 catalog)
router.get("/api/billing/plans", requireAuth, async (_req: Request, res: Response) => {
  res.json(listPublicPlans());
});

// Create checkout session to upgrade
router.post("/api/billing/checkout", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!isStripeConfigured()) return res.status(503).json({ error: "Stripe not configured" });
    if (!req.organizationId) return res.status(400).json({ error: "No organization" });

    const { plan } = req.body;
    if (!plan || !isPaidPlanKey(plan)) {
      return res.status(400).json({
        error: "Invalid plan. Use starter, growth, scale, or enterprise.",
      });
    }

    const priceId = resolveStripePriceId(plan);
    if (!priceId) {
      return res.status(400).json({
        error: `Stripe price not configured for ${plan}. Set STRIPE_${plan.toUpperCase()}_PRICE_ID or run npm run stripe:sync-prices.`,
      });
    }

    const org = await storage.getOrganization(req.organizationId);
    if (!org) return res.status(404).json({ error: "Organization not found" });

    let customerId = org.stripeCustomerId;
    if (!customerId) {
      const customer = await createStripeCustomer(org.id, req.userEmail!, org.name);
      if (!customer) return res.status(500).json({ error: "Failed to create Stripe customer" });
      customerId = customer.id;
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const session = await createCheckoutSession(
      org.id,
      customerId,
      priceId,
      `${baseUrl}/billing?success=true`,
      `${baseUrl}/billing?canceled=true`,
      plan
    );

    res.json({ url: session.url });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create portal session to manage subscription
router.post("/api/billing/portal", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!isStripeConfigured()) return res.status(503).json({ error: "Stripe not configured" });
    if (!req.organizationId) return res.status(400).json({ error: "No organization" });

    const org = await storage.getOrganization(req.organizationId);
    if (!org?.stripeCustomerId) {
      return res.status(400).json({ error: "No billing account found. Subscribe to a plan first." });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const session = await createPortalSession(org.stripeCustomerId, `${baseUrl}/billing`);

    res.json({ url: session.url });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/** Cancel auto-renew — keeps access until currentPeriodEnd, then Stripe deletes the sub */
router.post("/api/billing/cancel-renewal", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!isStripeConfigured()) return res.status(503).json({ error: "Stripe not configured" });
    if (!req.organizationId) return res.status(400).json({ error: "No organization" });

    const org = await storage.getOrganization(req.organizationId);
    if (!org?.stripeSubscriptionId) {
      return res.status(400).json({ error: "No active subscription to cancel" });
    }

    const subscription = await setSubscriptionAutoRenew(org.stripeSubscriptionId, false);
    res.json({
      ok: true,
      message: "Auto-renew turned off. You keep access until the end of the billing period.",
      subscription,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/** Resume auto-renew after a pending cancel-at-period-end */
router.post("/api/billing/resume-renewal", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!isStripeConfigured()) return res.status(503).json({ error: "Stripe not configured" });
    if (!req.organizationId) return res.status(400).json({ error: "No organization" });

    const org = await storage.getOrganization(req.organizationId);
    if (!org?.stripeSubscriptionId) {
      return res.status(400).json({ error: "No subscription to resume" });
    }

    const subscription = await setSubscriptionAutoRenew(org.stripeSubscriptionId, true);
    res.json({
      ok: true,
      message: "Auto-renew turned back on.",
      subscription,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Stripe webhook (no auth — Stripe calls this directly)
router.post("/api/billing/webhook", async (req: Request, res: Response) => {
  try {
    const signature = req.headers["stripe-signature"] as string;
    if (!signature) return res.status(400).json({ error: "Missing stripe-signature header" });

    const result = await handleWebhookEvent(req.body, signature);
    res.json(result);
  } catch (error: any) {
    console.error("Stripe webhook error:", error.message);
    res.status(400).json({ error: error.message });
  }
});

export default router;
