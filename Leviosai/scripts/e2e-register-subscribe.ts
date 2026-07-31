/**
 * E2E: register new account → Stripe create/update/renew/cancel → verify DB
 * Run: npx tsx scripts/e2e-register-subscribe.ts
 */

import "dotenv/config";
import Stripe from "stripe";
import { resolveStripePriceId } from "../lib/pricing.js";

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const LOCAL = "http://localhost:3000";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(
  label: string,
  fn: () => Promise<boolean>,
  { timeoutMs = 45000, intervalMs = 1500 } = {}
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) {
      console.log(`PASS  ${label}`);
      return;
    }
    await sleep(intervalMs);
  }
  throw new Error(`TIMEOUT waiting for: ${label}`);
}

async function main() {
  const stamp = Date.now();
  const email = `e2e_${stamp}@leviosai.test`;
  const password = "TestPass123!";

  console.log("API:", LOCAL, "(webhooks via", BASE + ")");
  console.log("Registering", email);

  const reg = await fetch(`${LOCAL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      firstName: "E2E",
      lastName: "Tester",
      organizationName: `E2E Org ${stamp}`,
    }),
  });
  const regBody = await reg.json();
  if (!reg.ok) throw new Error(`register failed: ${JSON.stringify(regBody)}`);
  const token = regBody.token as string;
  const orgId = regBody.user.organizationId as number;
  const workspaceId = regBody.user.workspaceId as string;
  console.log("PASS  register", { orgId, workspaceId });

  const billing0 = await fetch(`${LOCAL}/api/billing`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  if (billing0.sdr?.isActive) throw new Error("workspace should start inactive");
  console.log("PASS  workspace inactive before subscribe");

  const starter = resolveStripePriceId("starter");
  const growth = resolveStripePriceId("growth");
  if (!starter || !growth) throw new Error("missing Stripe price IDs");

  // Create Stripe customer + attach test card + subscribe Starter
  const customer = await stripe.customers.create({
    email,
    name: `E2E Org ${stamp}`,
    metadata: { organizationId: String(orgId), workspaceId },
  });
  const pm = await stripe.paymentMethods.create({
    type: "card",
    card: { token: "tok_visa" },
  });
  await stripe.paymentMethods.attach(pm.id, { customer: customer.id });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: pm.id },
  });

  // Link customer on org before webhooks arrive
  const { db } = await import("../lib/db.js");
  const { organizations, workspaces } = await import("../lib/schema.js");
  const { eq } = await import("drizzle-orm");
  await db
    .update(organizations)
    .set({ stripeCustomerId: customer.id })
    .where(eq(organizations.id, orgId));

  const sub = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: starter }],
    metadata: { planKey: "starter", organizationId: String(orgId) },
    expand: ["latest_invoice"],
  });
  console.log("Stripe subscription created", sub.id, sub.status);

  await waitFor("activate after subscription.created (starter)", async () => {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    return (
      org?.plan === "starter" &&
      org?.stripeSubscriptionId === sub.id &&
      ws?.isActive === true &&
      ws?.tier === "starter"
    );
  });

  // Bump usage so invoice.paid reset is observable
  await db
    .update(workspaces)
    .set({ monthlyLeadsUsed: 42, monthlyMinutesUsed: 17 })
    .where(eq(workspaces.id, workspaceId));

  // Upgrade to Growth
  await stripe.subscriptions.update(sub.id, {
    items: [{ id: sub.items.data[0].id, price: growth }],
    metadata: { planKey: "growth", organizationId: String(orgId) },
    proration_behavior: "none",
  });

  await waitFor("upgrade after subscription.updated (growth)", async () => {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    return org?.plan === "growth" && ws?.tier === "growth" && ws?.isActive === true;
  });

  // Simulate renew via signed invoice.paid (Dashboard may not fire a new paid invoice on update)
  const payload = JSON.stringify({
    id: `evt_e2e_${Date.now()}`,
    object: "event",
    api_version: "2024-11-20.acacia",
    created: Math.floor(Date.now() / 1000),
    type: "invoice.paid",
    data: {
      object: {
        id: `in_e2e_${Date.now()}`,
        object: "invoice",
        customer: customer.id,
        subscription: sub.id,
        status: "paid",
        amount_paid: 79700,
        currency: "usd",
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
  });
  const header = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  });
  const renewRes = await fetch(`${LOCAL}/api/billing/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": header },
    body: payload,
  });
  if (!renewRes.ok) throw new Error(`invoice.paid webhook failed: ${await renewRes.text()}`);

  await waitFor("usage reset after invoice.paid", async () => {
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    return ws?.monthlyLeadsUsed === 0 && ws?.monthlyMinutesUsed === 0;
  });

  // Cancel
  await stripe.subscriptions.cancel(sub.id);

  await waitFor("deactivate after subscription.deleted", async () => {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    return (
      (org?.plan === "free" || !org?.stripeSubscriptionId) &&
      ws?.isActive === false
    );
  });

  const billing = await fetch(`${LOCAL}/api/billing`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  console.log("Final billing snapshot:", {
    plan: billing.plan,
    active: billing.sdr?.isActive,
    tier: billing.sdr?.tier,
  });

  console.log("\nALL E2E SUBSCRIPTION STEPS PASSED");
  console.log(`Account: ${email} / ${password}`);
}

main().catch((e) => {
  console.error("E2E FAILED:", e.message || e);
  process.exit(1);
});
