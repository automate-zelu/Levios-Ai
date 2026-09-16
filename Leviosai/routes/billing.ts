import { Router, Request, Response } from "express";
import { requireAuth } from "./auth.js";
import { storage } from "../lib/storage.js";
import { db } from "../lib/db.js";
import { workspaces, organizations, users } from "../lib/schema.js";
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
import { getTierLimits, planKeyToSdrTier } from "../lib/tiers.js";
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

    const {
      getOrgCommercialPricing,
      getPlatformCommercialDefaults,
    } = await import("../lib/commercial-pricing-service.js");
    const commercial = await getOrgCommercialPricing(req.organizationId);
    const platformDefaults = await getPlatformCommercialDefaults();

    res.json({
      plan: planKey,
      planDetails: {
        ...planDetails,
        priceId: planDetails.priceId ? "configured" : null,
        monthlyPriceLabel: priceLabel,
      },
      commercialPricing: {
        monthlyFeeEnabled: commercial.monthlyFeeEnabled,
        monthlyFeeCents: commercial.monthlyFeeCents,
        monthlyFeeLabel: formatMonthlyPriceLabel(commercial.monthlyFeeCents).replace(" / mo", ""),
        monthlyUsesGlobalAmount: commercial.monthlyUsesGlobalAmount,
        appointmentFeeEnabled: commercial.appointmentFeeEnabled,
        appointmentFeeCents: commercial.appointmentFeeCents,
        appointmentFeeLabel: `$${(commercial.appointmentFeeCents / 100).toLocaleString("en-US", {
          minimumFractionDigits: commercial.appointmentFeeCents % 100 ? 2 : 0,
          maximumFractionDigits: 2,
        })}`,
      },
      platformDefaults: {
        monthlyFeeCents: platformDefaults.monthlyFeeCents,
      },
      subscription,
      billingCycle: {
        anchorAt: org.billingCycleAnchorAt || null,
        nextBillingAt: org.nextBillingAt || null,
        canceledAt: org.subscriptionCanceledAt || null,
        lastError: org.lastBillingError || null,
      },
      stripeConfigured: isStripeConfigured(),
      pricingModel: "monthly_retainer_plus_per_appointment",
      sdr: workspace
        ? {
            tier: workspace.tier,
            tierLabel: tierMeta.label,
            isActive: workspace.isActive,
            priceHint: tierMeta.priceHint,
            usage: {
              leadsUsed: workspace.monthlyLeadsUsed,
              minutesUsed: workspace.monthlyMinutesUsed,
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

// Create checkout for the monthly retainer (no multi-tier plan picker).
router.post("/api/billing/checkout", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!isStripeConfigured()) return res.status(503).json({ error: "Stripe not configured" });
    if (!req.organizationId) return res.status(400).json({ error: "No organization" });

    // Accept legacy plan keys for old clients; default to monthly retainer via starter price ID
    // (or STRIPE_MONTHLY_FEE_PRICE_ID when set).
    let plan = String(req.body?.plan || "monthly").toLowerCase();
    if (plan === "monthly" || plan === "retainer") plan = "starter";
    if (!isPaidPlanKey(plan)) {
      return res.status(400).json({
        error: "Invalid checkout request.",
      });
    }

    const priceId =
      (process.env.STRIPE_MONTHLY_FEE_PRICE_ID || "").trim() || resolveStripePriceId(plan) || null;

    const org = await storage.getOrganization(req.organizationId);
    if (!org) return res.status(404).json({ error: "Organization not found" });

    let customerId = org.stripeCustomerId;
    if (!customerId) {
      const customer = await createStripeCustomer(org.id, req.userEmail!, org.name);
      if (!customer) return res.status(500).json({ error: "Failed to create Stripe customer" });
      customerId = customer.id;
    }

    const { getOrgCommercialPricing } = await import("../lib/commercial-pricing-service.js");
    const commercial = await getOrgCommercialPricing(org.id);
    const unitAmountCents = commercial.monthlyFeeCents;
    if (!(unitAmountCents > 0) && !priceId) {
      return res.status(400).json({
        error:
          "Stripe monthly price not configured. Set STRIPE_MONTHLY_FEE_PRICE_ID or STRIPE_STARTER_PRICE_ID.",
      });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const successUrl = req.body?.successUrl || `${baseUrl}/billing?success=true`;
    const cancelUrl = req.body?.cancelUrl || `${baseUrl}/billing?canceled=true`;
    const session = await createCheckoutSession(
      org.id,
      customerId,
      priceId,
      successUrl,
      cancelUrl,
      plan,
      unitAmountCents
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
    await db
      .update(organizations)
      .set({ subscriptionCanceledAt: new Date() })
      .where(eq(organizations.id, org.id));
    void (async () => {
      const [member] = req.userId
        ? await db
            .select({ email: users.email, firstName: users.firstName })
            .from(users)
            .where(eq(users.id, req.userId))
            .limit(1)
        : [];
      const { sendProductEmail } = await import("../lib/product-email.js");
      const { subscriptionCanceledEmail } = await import("../lib/email-templates.js");
      const until = subscription.currentPeriodEnd
        ? new Date(subscription.currentPeriodEnd).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })
        : null;
      if (member?.email) {
        await sendProductEmail(
          member.email,
          subscriptionCanceledEmail({
            firstName: member.firstName,
            organizationName: org.name,
            accessThrough: until,
          })
        );
      }
    })().catch((err: Error) => console.error("Cancel email failed:", err.message));
    res.json({
      ok: true,
      message:
        "Monthly retainer canceled. Appointment booking fees are still charged to your card. You keep access until the end of the billing period.",
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
    await db
      .update(organizations)
      .set({ subscriptionCanceledAt: null })
      .where(eq(organizations.id, org.id));
    void (async () => {
      const [member] = req.userId
        ? await db
            .select({ email: users.email, firstName: users.firstName })
            .from(users)
            .where(eq(users.id, req.userId))
            .limit(1)
        : [];
      const { sendProductEmail } = await import("../lib/product-email.js");
      const { subscriptionResumedEmail } = await import("../lib/email-templates.js");
      const next = org.nextBillingAt
        ? new Date(org.nextBillingAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })
        : subscription.currentPeriodEnd
          ? new Date(subscription.currentPeriodEnd).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })
          : null;
      if (member?.email) {
        await sendProductEmail(
          member.email,
          subscriptionResumedEmail({
            firstName: member.firstName,
            organizationName: org.name,
            nextBillingAt: next,
          })
        );
      }
    })().catch((err: Error) => console.error("Resume email failed:", err.message));
    res.json({
      ok: true,
      message: "Subscription resumed. Your card will be charged automatically on your billing date.",
      subscription,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Current org monthly bill (retainer + appointment charges)
router.get("/api/billing/bill", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.organizationId) return res.status(400).json({ error: "No organization" });
    const {
      getOrgMonthlyBill,
      billingPeriodKey,
    } = await import("../lib/commercial-pricing-service.js");
    const period = (req.query.period as string) || billingPeriodKey();
    const bill = await getOrgMonthlyBill(req.organizationId, period);
    res.json(bill);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/api/billing/receipts", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.organizationId) return res.status(400).json({ error: "No organization" });
    const {
      listPlatformCharges,
      billingPeriodKey,
      summarizeCharges,
    } = await import("../lib/commercial-pricing-service.js");
    const periodRaw = (req.query.period as string) || "";
    const yearRaw = (req.query.year as string) || "";
    const startDate = (req.query.startDate as string) || "";
    const endDate = (req.query.endDate as string) || "";
    const period =
      !startDate && !endDate && periodRaw && periodRaw !== "all" ? periodRaw : undefined;
    const year =
      !startDate && !endDate && !period && yearRaw && yearRaw !== "all" ? yearRaw : undefined;
    const status = (req.query.status as string) || undefined;
    const feeKind = (req.query.feeKind as string) || undefined;
    const q = (req.query.q as string) || undefined;
    const charges = await listPlatformCharges({
      organizationId: req.organizationId,
      period,
      year,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      status: status && status !== "all" ? status : undefined,
      feeKind: feeKind && feeKind !== "all" ? feeKind : undefined,
      q,
      limit: Number(req.query.limit) || 200,
    });
    res.json({
      period: period || billingPeriodKey(),
      year: year ? Number(year) : null,
      startDate: startDate || null,
      endDate: endDate || null,
      charges,
      summary: summarizeCharges(charges),
      filters: {
        period: period || "all",
        year: year || "all",
        startDate: startDate || "",
        endDate: endDate || "",
        status: status || "all",
        feeKind: feeKind || "all",
        q: q || "",
      },
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
