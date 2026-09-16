/**
 * Drive SMS booking with canned lead replies (runs on the API host with .env).
 *   npx tsx scripts/sms-booking-e2e.ts
 */
import "dotenv/config";
import { db } from "../lib/db.js";
import { leads, sdrEnrollments } from "../lib/schema.js";
import { desc, eq, inArray, and } from "drizzle-orm";
import { storage } from "../lib/storage.js";
import { handleSdrSmsConversation } from "../lib/sdr-followup-reply.js";
import { initSdrQueue } from "../lib/sdr-queue.js";

const LEAD_ID = Number(process.env.LIVE_SDR_LEAD_ID || 14);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function leadSays(opts: {
  enrollmentId: string;
  workspaceId: string;
  lead: { id: number; firstName?: string | null; phone?: string | null };
  text: string;
}) {
  console.log(`\nLEAD → ${opts.text}`);
  await storage.createLeadMessage({
    leadId: opts.lead.id,
    channel: "sms",
    content: opts.text,
    status: "delivered",
    direction: "inbound",
    aiGenerated: false,
  });
  const result = await handleSdrSmsConversation({
    enrollmentId: opts.enrollmentId,
    lead: opts.lead,
    workspaceId: opts.workspaceId,
    inboundText: opts.text,
    fromPhone: opts.lead.phone || "",
  });
  console.log(`ARIA ← sent=${result.sent} intent=${result.intent} booked=${!!result.booked} synced=${!!result.calendarSynced}`);
  console.log(`      ${result.replyText}`);
  if (result.error) console.log(`      error=${result.error}`);
  return result;
}

async function main() {
  initSdrQueue({ enableWorker: false });
  const [lead] = await db.select().from(leads).where(eq(leads.id, LEAD_ID));
  if (!lead) throw new Error(`lead ${LEAD_ID} not found`);

  const [enrollment] = await db
    .select()
    .from(sdrEnrollments)
    .where(
      and(
        eq(sdrEnrollments.leadId, LEAD_ID),
        inArray(sdrEnrollments.status, ["sms_sent", "sms_replied", "email_sent", "email_replied"])
      )
    )
    .orderBy(desc(sdrEnrollments.updatedAt))
    .limit(1);

  if (!enrollment) {
    throw new Error("No SMS-active enrollment. Run miss→SMS first so status is sms_sent/sms_replied.");
  }

  console.log("=== SMS booking e2e ===");
  console.log("lead", lead.id, lead.firstName, lead.phone);
  console.log("enrollment", enrollment.id, enrollment.status);

  const ctx = {
    enrollmentId: enrollment.id,
    workspaceId: enrollment.workspaceId,
    lead: { id: lead.id, firstName: lead.firstName, phone: lead.phone },
  };

  const yes = await leadSays({ ...ctx, text: "Yes, let's book a time" });
  await sleep(1500);

  const slotMatch = yes.replyText.match(
    /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,\s+[A-Z][a-z]{2}\s+\d{1,2},\s+\d{1,2}:\d{2}\s+[AP]M\b/i
  );
  const bookText = slotMatch
    ? slotMatch[0].replace(/,.*/, "") + " 9am"
    : "Monday 9am";
  // Prefer an explicit parseable reply
  const book = await leadSays({ ...ctx, text: "Monday 9:00 am" });

  const [fresh] = await db.select().from(sdrEnrollments).where(eq(sdrEnrollments.id, enrollment.id));
  console.log("\nDONE  enrollment status=", fresh?.status, "booked=", book.booked);
  process.exit(book.booked || yes.sent ? 0 : 1);
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
