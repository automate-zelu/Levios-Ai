/**
 * Create Stripe Products + monthly Prices for Leviosai SDR tiers
 * (IMPLEMENTATION_PLAN §15 / §21.3).
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_... npx tsx scripts/create-stripe-prices.ts
 *
 * Prints env lines to paste into .env.
 */

import "dotenv/config";
import Stripe from "stripe";
import {
  PAID_PLAN_ORDER,
  PLAN_PRICING,
  stripePriceEnvKey,
} from "../lib/pricing.js";

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.startsWith("REPLACE")) {
    console.error("Set a real STRIPE_SECRET_KEY before running this script.");
    process.exit(1);
  }

  const stripe = new Stripe(key);
  const lines: string[] = [];

  console.log("Creating Stripe products/prices for Leviosai SDR plans...\n");

  for (const planKey of PAID_PLAN_ORDER) {
    const plan = PLAN_PRICING[planKey];
    const product = await stripe.products.create({
      name: `Leviosai SDR — ${plan.name}`,
      description: `${plan.features.join(" · ")}. Suggested band ${plan.priceHint}.`,
      metadata: { leviosai_plan: planKey },
    });

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.monthlyPriceCents,
      currency: "usd",
      recurring: { interval: "month" },
      metadata: { leviosai_plan: planKey },
      nickname: `${plan.name} monthly`,
    });

    const envKey = stripePriceEnvKey(planKey);
    lines.push(`${envKey}=${price.id}`);
    console.log(`✓ ${plan.name}: ${plan.monthlyPriceCents / 100} USD/mo → ${price.id}`);
  }

  console.log("\nAdd these to your .env:\n");
  console.log(lines.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
