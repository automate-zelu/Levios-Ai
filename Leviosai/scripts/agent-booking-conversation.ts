/**
 * Text-only agent booking rehearsal (no Twilio / browser mic).
 * Plays the lead through LangChainCallAgent until a slot is booked.
 *
 * Run: npx tsx scripts/agent-booking-conversation.ts
 */

import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../lib/db.js";
import {
  appointmentCharges,
  appointments,
  calendarConnections,
  leads,
  organizations,
  sdrConfigs,
  workspaces,
} from "../lib/schema.js";
import { LangChainCallAgent } from "../lib/calling/langchain-agent.js";
import { injectCalendarPromptBlock } from "../lib/calendar/prompt-block.js";
import { getCalendarStatus } from "../lib/calendar/service.js";
import {
  getOrgCommercialPricing,
  updateOrgCommercialPricing,
  ensureCommercialPricingSchema,
} from "../lib/commercial-pricing-service.js";
import { formatUsdFromCents } from "../lib/commercial-pricing.js";

function log(label: string, detail?: unknown) {
  console.log(`\n── ${label}`);
  if (detail !== undefined) console.log(typeof detail === "string" ? detail : JSON.stringify(detail, null, 2));
}

async function main() {
  console.log("\nAgent booking conversation (text only, no phone call)");
  if (process.env.AGENT_CALENDAR_MOCK === "1") {
    console.log("MODE: AGENT_CALENDAR_MOCK=1 (fake open slots, no live Google API)\n");
  } else {
    console.log("MODE: live calendar\n");
  }
  await ensureCommercialPricingSchema();

  const [conn] = await db.select().from(calendarConnections).limit(1);
  if (!conn) {
    console.error("FAIL  No calendar connection in DB — connect Google Calendar on SDR Setup first.");
    process.exit(1);
  }

  const orgId = conn.organizationId;
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.organizationId, orgId))
    .limit(1);
  const [lead] = await db
    .select()
    .from(leads)
    .where(eq(leads.organizationId, orgId))
    .limit(1);

  if (!lead) {
    console.error("FAIL  Need at least one lead for this organization.");
    process.exit(1);
  }

  const [cfg] = ws
    ? await db.select().from(sdrConfigs).where(eq(sdrConfigs.workspaceId, ws.id)).limit(1)
    : [null];

  const status = await getCalendarStatus(orgId);
  log("context", {
    org: org?.name,
    orgId,
    workspaceId: ws?.id || null,
    lead: `${lead.firstName} ${lead.lastName}`.trim(),
    leadId: lead.id,
    calendar: status.activeProvider,
    calendarEmail: status.connections?.[0]?.accountEmail || conn.accountEmail,
  });

  // Ensure we can observe an appointment fee if booking succeeds
  const beforePricing = await getOrgCommercialPricing(orgId);
  if (!beforePricing.appointmentFeeEnabled || beforePricing.appointmentFeeCents <= 0) {
    await updateOrgCommercialPricing(orgId, {
      appointmentFeeEnabled: true,
      costPerAppointmentCents: beforePricing.appointmentFeeCents || 40_000,
    });
    log("enabled appointment fee for this rehearsal", {
      amount: formatUsdFromCents(beforePricing.appointmentFeeCents || 40_000),
    });
  } else {
    log("appointment fee already on", {
      amount: formatUsdFromCents(beforePricing.appointmentFeeCents),
    });
  }

  const basePrompt =
    (cfg?.systemPrompt || "").trim() ||
    `You are ${cfg?.assistantName || "Alex"}, an SDR booking a short consultation.
Keep replies to 1-2 spoken sentences. Be helpful and close the meeting.`;

  const prompt = injectCalendarPromptBlock(basePrompt, {
    provider: status.activeProvider,
    accountEmail: status.connections?.[0]?.accountEmail || conn.accountEmail,
    prefs: status.bookingPrefs,
  });

  const sessionId = `agent-book-${Date.now()}`;
  const agent = new LangChainCallAgent();
  await agent.init({
    sessionId,
    systemPrompt: prompt,
    workspaceId: ws?.id || "",
    organizationId: orgId,
    leadId: lead.id,
    llmModel: (cfg as any)?.llmModel || "gpt-4o-mini",
  });

  const turns: Array<{ role: "lead" | "agent"; text: string }> = [];

  async function say(leadText: string) {
    turns.push({ role: "lead", text: leadText });
    console.log(`\nLEAD: ${leadText}`);
    const reply = await agent.respond(sessionId, leadText);
    turns.push({ role: "agent", text: reply });
    console.log(`AGENT: ${reply}`);
    return reply;
  }

  // Opening
  await say(
    "[CALL_CONNECTED] The lead just answered. Greet them briefly and ask if they have a minute to schedule a consultation."
  );

  await say(
    `Hi, this is ${lead.firstName || "Alex"}. Yeah I have a minute — I'd like to book something soon.`
  );

  await say(
    "What times do you have open this week or next? Please check your calendar and give me a couple of real options."
  );

  // Ask agent again if it didn't offer times — push toward booking
  let booked = agent.getMidCallBooking();
  if (!booked) {
    await say(
      "The first option you mentioned works for me. Please book that exact slot on the calendar now and confirm the date and time."
    );
  }

  booked = agent.getMidCallBooking();
  if (!booked) {
    await say(
      "Yes, go ahead and lock in whichever open slot you offered first. Confirm it is booked."
    );
  }

  booked = agent.getMidCallBooking();
  if (!booked) {
    // Last push: ask them to check availability then book
    await say(
      "Please use your calendar tools: check availability, then book the earliest open slot for me. My name is on the lead record."
    );
  }

  booked = agent.getMidCallBooking();

  const pricing = await getOrgCommercialPricing(orgId);
  let charge: any = null;
  let apptRow: any = null;

  if (booked?.appointmentId) {
    const [a] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.id, booked.appointmentId))
      .limit(1);
    apptRow = a || null;
    const [c] = await db
      .select()
      .from(appointmentCharges)
      .where(eq(appointmentCharges.appointmentId, booked.appointmentId))
      .limit(1);
    charge = c || null;
  }

  console.log("\n════════════════════════════════════════");
  console.log("RESULT");
  console.log("════════════════════════════════════════");
  if (booked) {
    console.log("BOOKING: SUCCESS");
    console.log(
      JSON.stringify(
        {
          appointmentId: booked.appointmentId,
          scheduledAt: booked.scheduledAt.toISOString(),
          crmTitle: apptRow?.title || null,
          crmStatus: apptRow?.status || null,
          calendarEventId: apptRow?.calendarEventId || null,
          calendarProvider: apptRow?.calendarProvider || null,
          charge: charge
            ? {
                id: charge.id,
                amount: formatUsdFromCents(charge.amountCents),
                status: charge.status,
                feeKind: charge.feeKind,
              }
            : null,
          expectedFee: formatUsdFromCents(pricing.appointmentFeeCents),
        },
        null,
        2
      )
    );
  } else {
    console.log("BOOKING: FAILED — agent never completed book_appointment");
    console.log(
      JSON.stringify(
        {
          turns: turns.length,
          lastAgent: turns.filter((t) => t.role === "agent").slice(-1)[0]?.text || null,
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  }
  console.log("");
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
  console.error(err);
  process.exit(1);
});
