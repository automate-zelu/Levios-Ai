/**
 * Live Stripe webhook verification against ngrok/local server.
 * Exercises create → update → renew(invoice.paid) → delete via signed events,
 * and optionally a real Stripe subscription if DB is healthy.
 *
 * Run: npx tsx scripts/verify-stripe-webhooks.ts
 */

import "dotenv/config";
import Stripe from "stripe";
import { resolveStripePriceId } from "../lib/pricing.js";

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const WEBHOOK = `${BASE}/api/billing/webhook`;
const SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || "";

function assert(cond: any, msg: string) {
  if (!cond) throw new Error(msg);
}

async function postSignedEvent(type: string, object: Record<string, unknown>) {
  assert(SECRET && !SECRET.startsWith("REPLACE"), "STRIPE_WEBHOOK_SECRET missing");
  assert(STRIPE_KEY && !STRIPE_KEY.startsWith("REPLACE"), "STRIPE_SECRET_KEY missing");

  const stripe = new Stripe(STRIPE_KEY);
  const payload = JSON.stringify({
    id: `evt_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    object: "event",
    api_version: "2024-11-20.acacia",
    created: Math.floor(Date.now() / 1000),
    type,
    data: { object },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
  });

  const header = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: SECRET,
  });

  const res = await fetch(WEBHOOK, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": header,
    },
    body: payload,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, text, json };
}

async function main() {
  console.log("BASE_URL:", BASE);
  console.log("Webhook:", WEBHOOK);

  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  console.log("Health stripe:", health.services?.stripe, "database:", health.services?.database);

  const results: Array<{ step: string; ok: boolean; detail: string }> = [];

  // 1) Reject unsigned
  {
    const res = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const ok = res.status === 400;
    results.push({
      step: "reject unsigned webhook",
      ok,
      detail: `status=${res.status}`,
    });
  }

  const customerId = `cus_test_verify_${Date.now()}`;
  const subId = `sub_test_verify_${Date.now()}`;
  const starterPrice = resolveStripePriceId("starter") || "price_missing";
  const growthPrice = resolveStripePriceId("growth") || "price_missing";

  // 2) subscription.created
  {
    const { status, json, text } = await postSignedEvent("customer.subscription.created", {
      id: subId,
      object: "subscription",
      customer: customerId,
      status: "active",
      metadata: { planKey: "starter" },
      items: {
        object: "list",
        data: [{ id: "si_1", price: { id: starterPrice } }],
      },
    });
    // 200 if handled; may be 200 even if org not found (no-op update)
    const ok = status === 200 && (json?.received === true || text.includes("received"));
    results.push({
      step: "subscription.created",
      ok,
      detail: `status=${status} body=${text.slice(0, 120)}`,
    });
  }

  // 3) subscription.updated (upgrade)
  {
    const { status, text } = await postSignedEvent("customer.subscription.updated", {
      id: subId,
      object: "subscription",
      customer: customerId,
      status: "active",
      metadata: { planKey: "growth" },
      items: {
        object: "list",
        data: [{ id: "si_1", price: { id: growthPrice } }],
      },
    });
    results.push({
      step: "subscription.updated (upgrade)",
      ok: status === 200,
      detail: `status=${status} body=${text.slice(0, 120)}`,
    });
  }

  // 4) invoice.paid (renew)
  {
    const { status, text } = await postSignedEvent("invoice.paid", {
      id: `in_test_${Date.now()}`,
      object: "invoice",
      customer: customerId,
      subscription: subId,
      status: "paid",
      amount_paid: 79700,
      currency: "usd",
    });
    results.push({
      step: "invoice.paid (renew / reset usage)",
      ok: status === 200,
      detail: `status=${status} body=${text.slice(0, 120)}`,
    });
  }

  // 5) subscription.deleted
  {
    const { status, text } = await postSignedEvent("customer.subscription.deleted", {
      id: subId,
      object: "subscription",
      customer: customerId,
      status: "canceled",
      items: { object: "list", data: [] },
    });
    results.push({
      step: "subscription.deleted",
      ok: status === 200,
      detail: `status=${status} body=${text.slice(0, 120)}`,
    });
  }

  // 6) Real Stripe API subscription (fires Dashboard → ngrok webhooks) if possible
  if (health.services?.database === "ok" && starterPrice.startsWith("price_")) {
    const stripe = new Stripe(STRIPE_KEY);
    try {
      const customer = await stripe.customers.create({
        email: `stripe-verify-${Date.now()}@leviosai.test`,
        name: "Leviosai Webhook Verify",
        payment_method: "pm_card_visa",
        invoice_settings: { default_payment_method: "pm_card_visa" },
      });
      const sub = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: starterPrice }],
        metadata: { planKey: "starter", verify: "true" },
        payment_behavior: "default_incomplete",
        expand: ["latest_invoice.payment_intent"],
      });
      // pay with test clock / confirm
      await stripe.subscriptions.update(sub.id, {
        items: [{ id: sub.items.data[0].id, price: growthPrice }],
        metadata: { planKey: "growth", verify: "true" },
        proration_behavior: "none",
      });
      await stripe.subscriptions.cancel(sub.id);
      results.push({
        step: "live Stripe create→update→cancel",
        ok: true,
        detail: `customer=${customer.id} sub=${sub.id}`,
      });
    } catch (e: any) {
      results.push({
        step: "live Stripe create→update→cancel",
        ok: false,
        detail: e.message,
      });
    }
  } else {
    results.push({
      step: "live Stripe create→update→cancel",
      ok: false,
      detail:
        health.services?.database !== "ok"
          ? "SKIPPED — database unhealthy (cannot activate workspace in app)"
          : "SKIPPED — missing Stripe price IDs",
    });
  }

  console.log("\n=== RESULTS ===");
  let failed = 0;
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.step} — ${r.detail}`);
    if (!r.ok && !r.detail.startsWith("SKIPPED")) failed++;
  }

  if (health.services?.database !== "ok") {
    console.log(
      "\nNOTE: DATABASE_URL is down (Supabase tenant not found). Webhook signature handling was tested, but org/workspace activation cannot persist until DB is fixed."
    );
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
