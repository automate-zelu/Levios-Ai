/**
 * Drive email booking with canned lead replies (API host + .env).
 * Closes a booked cycle, sends the SDR email, then runs a 3-step conversation.
 *
 *   npx tsx scripts/email-booking-e2e.ts
 */
import "dotenv/config";
import { db } from "../lib/db.js";
import {
  leads,
  sdrEnrollments,
  sdrConfigs,
  workspaces,
  organizations,
} from "../lib/schema.js";
import { desc, eq } from "drizzle-orm";
import { storage } from "../lib/storage.js";
import { stateMachine } from "../lib/sdr-state-machine.js";
import { sendEmailViaGmail } from "../lib/gmail/send.js";
import { handleSdrEmailConversation } from "../lib/sdr-followup-reply.js";
import { buildSdrTemplateContext, renderSdrTemplate } from "../lib/sdr-template-vars.js";
import { initSdrQueue } from "../lib/sdr-queue.js";

const LEAD_ID = Number(process.env.LIVE_SDR_LEAD_ID || 14);
const WS_ID = "29775f48-44d4-4e1b-b684-8a1c9eabd3cf";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function leadEmails(opts: {
  enrollmentId: string;
  workspaceId: string;
  organizationId: number;
  lead: { id: number; firstName?: string | null; email?: string | null; organizationId?: number | null };
  subject: string;
  text: string;
}) {
  console.log(`\nLEAD EMAIL → ${opts.text.slice(0, 120)}`);
  await storage.createLeadMessage({
    leadId: opts.lead.id,
    channel: "email",
    content: `Subject: ${opts.subject}\n\n${opts.text}`,
    status: "delivered",
    direction: "inbound",
    aiGenerated: false,
  });
  const result = await handleSdrEmailConversation({
    enrollmentId: opts.enrollmentId,
    lead: opts.lead,
    workspaceId: opts.workspaceId,
    organizationId: opts.organizationId,
    inboundText: opts.text,
    inboundSubject: opts.subject,
    fromEmail: opts.lead.email || "",
  });
  console.log(
    `ARIA EMAIL ← sent=${result.sent} intent=${result.intent} booked=${!!result.booked} synced=${!!result.calendarSynced}`
  );
  console.log(`      ${result.replyText.slice(0, 400)}`);
  if (result.error) console.log(`      error=${result.error}`);
  return result;
}

async function main() {
  initSdrQueue({ enableWorker: false });

  const [lead] = await db.select().from(leads).where(eq(leads.id, LEAD_ID));
  if (!lead?.email) throw new Error("lead 14 missing email");

  const [latest] = await db
    .select()
    .from(sdrEnrollments)
    .where(eq(sdrEnrollments.leadId, LEAD_ID))
    .orderBy(desc(sdrEnrollments.enrolledAt))
    .limit(1);

  if (latest && ["booked", "pending", "call_initiated", "call_connected", "sms_sent", "sms_replied"].includes(latest.status)) {
    await db
      .update(sdrEnrollments)
      .set({
        status: "exhausted",
        exhaustedAt: new Date(),
        nextEnrollAfter: null,
        updatedAt: new Date(),
      })
      .where(eq(sdrEnrollments.id, latest.id));
    console.log("closed prior cycle", latest.id, latest.status, "→ exhausted");
  }

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, WS_ID));
  if (!ws?.organizationId) throw new Error("workspace missing org");
  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, ws.organizationId));
  const [config] = await db.select().from(sdrConfigs).where(eq(sdrConfigs.workspaceId, WS_ID));
  if (!config) throw new Error("no SDR config");

  const [enrollment] = await db
    .insert(sdrEnrollments)
    .values({
      workspaceId: WS_ID,
      leadId: LEAD_ID,
      status: "sms_sent",
      currentStep: 3,
      callAttempts: 0,
      nextEnrollAfter: null,
    })
    .returning();

  const ctx = buildSdrTemplateContext(lead, org?.name);
  const subject = renderSdrTemplate(config.emailSubject, ctx);
  const body = renderSdrTemplate(config.emailBody, ctx);

  console.log("=== Email booking e2e ===");
  console.log("lead", lead.id, lead.email);
  console.log("enrollment", enrollment.id);
  console.log("sending SDR email:", subject);

  const sent = await sendEmailViaGmail(ws.organizationId, lead.email, subject, body);
  if (!sent.success) throw new Error(sent.error || "Gmail send failed");
  console.log("outbound Gmail id", sent.id, "from", sent.from);

  await storage.createLeadMessage({
    leadId: lead.id,
    channel: "email",
    content: `Subject: ${subject}\n\n${body}`,
    status: "sent",
    direction: "outbound",
    aiGenerated: true,
  });

  if (stateMachine.canTransition("sms_sent", "email_sent")) {
    await stateMachine.transition(enrollment.id, "email_sent", {
      emailId: sent.id,
      channel: "email",
      to: lead.email,
      from: sent.from,
    });
  }

  const conv = {
    enrollmentId: enrollment.id,
    workspaceId: WS_ID,
    organizationId: ws.organizationId,
    lead: {
      id: lead.id,
      firstName: lead.firstName,
      email: lead.email,
      organizationId: lead.organizationId,
    },
  };

  await sleep(1200);
  const q = await leadEmails({
    ...conv,
    subject: `Re: ${subject}`,
    text: "Hi — what is this email about? I'm not sure we spoke.",
  });

  await sleep(1500);
  const yes = await leadEmails({
    ...conv,
    subject: `Re: ${subject}`,
    text: "Yes, I'm open to a short call. What times do you have this week?",
  });

  await sleep(1500);
  const book = await leadEmails({
    ...conv,
    subject: `Re: ${subject}`,
    text: "Tuesday 10:00 am works for me.",
  });

  const [fresh] = await db.select().from(sdrEnrollments).where(eq(sdrEnrollments.id, enrollment.id));
  console.log("\nDONE  status=", fresh?.status, "q.sent=", q.sent, "yes.booked=", yes.booked, "book.booked=", book.booked);
  if (!book.booked) process.exit(1);
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
