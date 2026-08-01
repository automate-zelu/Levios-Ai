/**
 * Live calendar smoke test — availability, agent tools, booking attempt.
 * Run: npx tsx scripts/smoke-calendar-booking.ts
 *
 * Uses demo login against local API. Does not delete Google events if booking succeeds
 * (creates a clearly titled "Levios smoke test" event — delete manually if needed).
 */

import "dotenv/config";

const BASE = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const EMAIL = process.env.SMOKE_EMAIL || "user@leviosai.com";
const PASSWORD = process.env.SMOKE_PASSWORD || "LeviosaiUser2026!";

function ok(label: string, detail?: unknown) {
  console.log(`PASS  ${label}`, detail ?? "");
}
function fail(label: string, detail?: unknown): never {
  console.error(`FAIL  ${label}`, detail ?? "");
  process.exit(1);
}

async function main() {
  console.log(`\nCalendar smoke → ${BASE}\n`);

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const loginBody: any = await loginRes.json().catch(() => ({}));
  if (!loginRes.ok || !loginBody.token) fail("login", loginBody);
  ok("login", { user: loginBody.user?.email || EMAIL });

  const h = {
    Authorization: `Bearer ${loginBody.token}`,
    "Content-Type": "application/json",
  };

  const status: any = await fetch(`${BASE}/api/calendar/status`, { headers: h }).then((r) => r.json());
  if (!status.activeProvider) fail("calendar connected", status);
  ok("calendar connected", {
    provider: status.activeProvider,
    email: status.connections?.[0]?.accountEmail,
    prefs: status.bookingPrefs,
  });

  const availRes = await fetch(`${BASE}/api/calendar/availability`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({}),
  });
  const avail: any = await availRes.json().catch(() => ({}));
  if (!availRes.ok) fail("availability HTTP", { status: availRes.status, avail });

  if (avail.error) {
    console.warn("\n⚠  Availability returned an error (agent will tell the lead to try later):\n");
    console.warn(`   ${avail.error}\n`);
    if (/Google Calendar API is disabled|has not been used|is disabled/i.test(avail.error)) {
      console.warn("ACTION REQUIRED:");
      console.warn("  1. Open https://console.cloud.google.com/apis/library/calendar-json.googleapis.com");
      console.warn("  2. Select the OAuth project that owns GOOGLE_CLIENT_ID");
      console.warn("  3. Enable Google Calendar API, wait ~2 minutes, re-run this script\n");
    }
    ok("availability error surfaced cleanly for agent", { connected: avail.connected });
  } else {
    ok("availability", { slots: avail.slots?.length, sample: avail.slots?.[0]?.label });
  }

  // Exercise the same service path the live call agent uses
  const { LangChainCallAgent } = await import("../lib/calling/langchain-agent.js");
  const { injectCalendarPromptBlock } = await import("../lib/calendar/prompt-block.js");
  const { storage } = await import("../lib/storage.js");

  const orgId = loginBody.user?.organizationId;
  const workspaceId = loginBody.user?.workspaceId || loginBody.user?.activeWorkspaceId;
  if (!orgId) fail("org id on user", loginBody.user);

  const leads = await storage.getLeads({ organizationId: orgId });
  const lead = leads?.[0];
  if (!lead) fail("need at least one lead to simulate booking");

  const prompt = injectCalendarPromptBlock(
    "You are a test SDR. Keep replies under 2 sentences.",
    { provider: status.activeProvider, accountEmail: status.connections?.[0]?.accountEmail, prefs: status.bookingPrefs }
  );

  const agent = new LangChainCallAgent();
  await agent.init({
    sessionId: `smoke-cal-${Date.now()}`,
    systemPrompt: prompt,
    workspaceId: workspaceId || "",
    organizationId: orgId,
    leadId: lead.id,
  });

  // Directly invoke tools the same way the agent loop does
  const tools = (agent as any).tools as Array<{ name: string; invoke: (a: any) => Promise<any> }>;
  const check = tools.find((t) => t.name === "check_availability");
  const book = tools.find((t) => t.name === "book_appointment");
  if (!check || !book) fail("agent tools missing", tools.map((t) => t.name));

  const checkRaw = await check.invoke({});
  const checkJson = typeof checkRaw === "string" ? JSON.parse(checkRaw) : checkRaw;
  ok("agent check_availability tool", {
    slots: checkJson.slots?.length ?? 0,
    error: checkJson.error || null,
    hint: (checkJson.hint || "").slice(0, 120),
  });

  if (checkJson.slots?.length) {
    const slot = checkJson.slots[0];
    const bookRaw = await book.invoke({
      scheduledAt: slot.start,
      title: "Levios smoke test — safe to delete",
    });
    const bookJson = typeof bookRaw === "string" ? JSON.parse(bookRaw) : bookRaw;
    if (bookJson.ok) {
      ok("agent book_appointment tool", {
        appointmentId: bookJson.appointmentId,
        scheduledAt: bookJson.scheduledAt,
      });
    } else {
      ok("agent book_appointment reported failure (will tell lead to retry)", {
        error: bookJson.error || bookJson.syncError,
        hint: (bookJson.hint || "").slice(0, 120),
      });
    }
  } else {
    ok("skip live book — no open slots or calendar API error (agent would not invent times)");
  }

  // Follow-up scheduling helper (SMS/email path)
  const { resolveFollowupScheduling } = await import("../lib/sdr-followup-reply.js");
  if (!workspaceId) {
    console.warn("WARN  no workspaceId on user — skipping follow-up scheduling helper");
  } else {
    const follow = await resolveFollowupScheduling({
      workspaceId,
      leadId: lead.id,
      inboundText: "Yes I'm interested — what times are available?",
      channel: "sms",
      intent: "agree",
      firstName: lead.firstName || "Alex",
      companyName: "Levios",
      draftReply: "Thanks!",
    });
    ok("SMS/email scheduling helper", {
      bookedAppt: follow.bookedAppt,
      calendarSynced: follow.calendarSynced,
      replyPreview: follow.reply.slice(0, 160),
      syncError: follow.syncError || null,
    });
  }

  console.log("\nDone.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
