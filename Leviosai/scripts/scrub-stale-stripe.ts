/**
 * Audit + clear stale Stripe customer/subscription IDs on all organizations.
 * Uses STRIPE_SECRET_KEY (test mode) + DATABASE_URL from .env.
 *
 * Run: npx tsx scripts/scrub-stale-stripe.ts
 * Dry: DRY_RUN=1 npx tsx scripts/scrub-stale-stripe.ts
 */
import "dotenv/config";
import { db } from "../lib/db.js";
import { organizations } from "../lib/schema.js";
import {
  clearOrgStripeBillingIds,
  stripeCustomerExists,
  stripeSubscriptionExists,
} from "../lib/stripe-hygiene.js";

const DRY = process.env.DRY_RUN === "1";

async function main() {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error("STRIPE_SECRET_KEY missing");
    process.exit(1);
  }
  const orgs = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      stripeCustomerId: organizations.stripeCustomerId,
      stripeSubscriptionId: organizations.stripeSubscriptionId,
      servicePaused: organizations.servicePaused,
      pauseReason: organizations.pauseReason,
    })
    .from(organizations);

  console.log(`Auditing ${orgs.length} organizations (dry=${DRY})…`);
  let cleared = 0;
  let ok = 0;
  let skipped = 0;

  for (const org of orgs) {
    const cus = org.stripeCustomerId;
    const sub = org.stripeSubscriptionId;
    if (!cus && !sub) {
      skipped++;
      continue;
    }

    let cusOk = !cus;
    let subOk = !sub;
    let cusErr = "";
    let subErr = "";

    if (cus) {
      try {
        cusOk = await stripeCustomerExists(cus);
        if (!cusOk) cusErr = "missing";
      } catch (e: any) {
        cusOk = false;
        cusErr = e?.message || String(e);
      }
    }
    if (sub) {
      try {
        subOk = await stripeSubscriptionExists(sub);
        if (!subOk) subErr = "missing";
      } catch (e: any) {
        subOk = false;
        subErr = e?.message || String(e);
      }
    }

    if (cusOk && subOk) {
      ok++;
      console.log(`  OK  org ${org.id} (${org.name}) cus=${cus || "-"} sub=${sub || "-"}`);
      continue;
    }

    const clearPause =
      Boolean(org.servicePaused) ||
      org.pauseReason === "monthly_charge_failed" ||
      org.pauseReason === "payment_failed";
    console.log(
      `  BAD org ${org.id} (${org.name}) cus=${cus || "-"}(${cusOk ? "ok" : cusErr}) sub=${sub || "-"}(${subOk ? "ok" : subErr}) clearPause=${clearPause}`
    );
    if (!DRY) {
      await clearOrgStripeBillingIds(org.id, { clearPause });
      cleared++;
    } else {
      cleared++;
    }
  }

  console.log(`\nDone. ok=${ok} cleared=${cleared} no_ids=${skipped} dry=${DRY}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
