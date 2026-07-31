/**
 * Smoke: subscribe → cancel auto-renew → resume auto-renew
 * Run: npx tsx scripts/smoke-auto-renew.ts
 */
import "dotenv/config";
import Stripe from "stripe";
import { resolveStripePriceId } from "../lib/pricing.js";

const LOCAL = "http://localhost:3000";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

async function main() {
  const stamp = Date.now();
  const email = `renew_${stamp}@leviosai.test`;
  const password = "TestPass123!";

  const reg = await fetch(`${LOCAL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      firstName: "R",
      lastName: "T",
      organizationName: `Renew ${stamp}`,
    }),
  });
  const regBody = await reg.json();
  if (!reg.ok) throw new Error(JSON.stringify(regBody));
  const token = regBody.token as string;
  const orgId = regBody.user.organizationId as number;
  const auth = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const starter = resolveStripePriceId("starter");
  if (!starter) throw new Error("missing starter price");

  const customer = await stripe.customers.create({
    email,
    metadata: { organizationId: String(orgId) },
  });
  const pm = await stripe.paymentMethods.create({
    type: "card",
    card: { token: "tok_visa" },
  });
  await stripe.paymentMethods.attach(pm.id, { customer: customer.id });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: pm.id },
  });

  const { db } = await import("../lib/db.js");
  const { organizations } = await import("../lib/schema.js");
  const { eq } = await import("drizzle-orm");
  await db
    .update(organizations)
    .set({ stripeCustomerId: customer.id })
    .where(eq(organizations.id, orgId));

  const sub = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: starter }],
    metadata: { planKey: "starter", organizationId: String(orgId) },
  });
  await db
    .update(organizations)
    .set({
      stripeSubscriptionId: sub.id,
      plan: "starter",
      stripePriceId: starter,
    })
    .where(eq(organizations.id, orgId));

  await new Promise((r) => setTimeout(r, 1500));

  const cancel = await fetch(`${LOCAL}/api/billing/cancel-renewal`, {
    method: "POST",
    headers: auth,
    body: "{}",
  });
  const cancelBody = await cancel.json();
  console.log("cancel", cancel.status, cancelBody.subscription);

  const resume = await fetch(`${LOCAL}/api/billing/resume-renewal`, {
    method: "POST",
    headers: auth,
    body: "{}",
  });
  const resumeBody = await resume.json();
  console.log("resume", resume.status, resumeBody.subscription);

  if (!cancel.ok || cancelBody.subscription?.autoRenew !== false) {
    throw new Error(`cancel failed: ${JSON.stringify(cancelBody)}`);
  }
  if (!resume.ok || resumeBody.subscription?.autoRenew !== true) {
    throw new Error(`resume failed: ${JSON.stringify(resumeBody)}`);
  }
  console.log("PASS auto-renew cancel/resume");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
