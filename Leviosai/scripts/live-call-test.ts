/**
 * Live AI call smoke test (no human phone required).
 *
 * Places an outbound call FROM a Leviosai Twilio number TO another Twilio
 * number that auto-answers with demo TwiML, so the media-stream pipeline
 * (Deepgram → LangChain → ElevenLabs) can run.
 *
 * Run: npx tsx scripts/live-call-test.ts
 * Optional: LIVE_CALL_TO=+1... to dial a real handset instead.
 */
import "dotenv/config";
import twilio from "twilio";
import { db } from "../lib/db.js";
import {
  organizations,
  workspaces,
  sdrConfigs,
  sdrCallSessions,
  leads,
} from "../lib/schema.js";
import { eq } from "drizzle-orm";
import { initiateCall } from "../lib/calling/call-orchestrator.js";
import { stateMachine } from "../lib/sdr-state-machine.js";
import { sdrEnrollments } from "../lib/schema.js";

// Must NOT be dry-run for a real Twilio call
delete process.env.SDR_DRY_RUN;

const FROM = process.env.LIVE_CALL_FROM || "+18258910126"; // already points at ngrok /api/call/connect
const TO =
  process.env.LIVE_CALL_TO ||
  "+16474907852"; // Twilio demo auto-answer — exercises answer path without a human

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl?.includes("http")) throw new Error("BASE_URL required (ngrok)");
  if (!process.env.TWILIO_ACCOUNT_SID && !process.env.TWILIO_MASTER_SID) {
    throw new Error("Twilio credentials missing");
  }

  // Ensure master fallback has a from-number
  process.env.TWILIO_PHONE_NUMBER = FROM;

  console.log("=== LIVE CALL TEST ===");
  console.log("BASE_URL:", baseUrl);
  console.log("FROM:", FROM);
  console.log("TO:", TO);
  console.log("(Set LIVE_CALL_TO to dial your own phone instead of Twilio demo)");

  const health = await fetch(`${baseUrl}/api/health`).then((r) => r.json());
  console.log("Health:", health.services);

  const stamp = Date.now();
  const [org] = await db
    .insert(organizations)
    .values({ name: `LiveCall Org ${stamp}`, plan: "starter" })
    .returning();

  const [ws] = await db
    .insert(workspaces)
    .values({
      organizationId: org.id,
      name: `LiveCall WS ${stamp}`,
      tier: "starter",
      isActive: true,
      monthlyLeadLimit: 500,
      monthlyLeadsUsed: 0,
      monthlyMinuteLimit: 5000,
      monthlyMinutesUsed: 0,
      seatLimit: 5,
      // Master-account number — no sub-account (getClientForWorkspace falls back to master)
      twilioSubAccountSid: null,
      twilioSubAuthToken: null,
      twilioPhoneNumber: FROM,
    })
    .returning();

  await db.insert(sdrConfigs).values({
    workspaceId: ws.id,
    assistantName: "Aria",
    assistantVoiceId: "21m00Tcm4TlvDq8ikWAM",
    systemPrompt:
      "You are Aria, a friendly AI SDR for Leviosai. Keep replies under 2 sentences. " +
      "Greet the lead, mention you are calling from Leviosai about their inquiry, and ask if now is a good time.",
    smsTemplate: "Hi {{lead_name}}, Aria from Leviosai tried calling — reply YES to chat.",
    emailSubject: "Quick follow-up from Leviosai",
    emailBody: "Hi {{lead_name}}, we tried reaching you by phone. Reply to this email anytime.",
    knowledgeBase: "Leviosai is an AI-powered CRM with automated SDR calling.",
    dormantDays: 0,
    waitCallHrs: 0,
    waitSmsHrs: 1,
    reEnrollDays: 7,
    isActive: true,
  });

  const [lead] = await db
    .insert(leads)
    .values({
      organizationId: org.id,
      firstName: "Live",
      lastName: "Test",
      email: `live_${stamp}@leviosai.test`,
      phone: TO,
      status: "new",
      consentStatus: "granted",
      dncClean: true,
      timezone: "UTC",
      lastContactedAt: null,
    })
    .returning();

  const [enrollment] = await db
    .insert(sdrEnrollments)
    .values({
      workspaceId: ws.id,
      leadId: lead.id,
      status: "pending",
      currentStep: 1,
    })
    .returning();

  console.log("Created workspace", ws.id);
  console.log("Created enrollment", enrollment.id, "lead", lead.id);

  console.log("Placing outbound AI call via initiateCall…");
  await initiateCall(enrollment.id);

  const [afterDial] = await db
    .select()
    .from(sdrEnrollments)
    .where(eq(sdrEnrollments.id, enrollment.id));
  console.log("Enrollment status after dial:", afterDial.status);

  const [session] = await db
    .select()
    .from(sdrCallSessions)
    .where(eq(sdrCallSessions.enrollmentId, enrollment.id))
    .limit(1);

  if (!session) {
    throw new Error("No call session created — dial may have been blocked (compliance/phone)");
  }

  console.log("Session:", {
    id: session.id,
    status: session.status,
    twilioCallSid: session.twilioCallSid,
    outcome: session.outcome,
  });

  const sid = process.env.TWILIO_MASTER_SID || process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_MASTER_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN!;
  const client = twilio(sid, token);

  // Poll Twilio + DB for up to ~90s
  const deadline = Date.now() + 90_000;
  let lastTwilioStatus = "";
  while (Date.now() < deadline) {
    if (session.twilioCallSid) {
      const call = await client.calls(session.twilioCallSid).fetch();
      if (call.status !== lastTwilioStatus) {
        lastTwilioStatus = call.status;
        console.log(
          `Twilio call ${call.sid}: status=${call.status} duration=${call.duration}s`
        );
      }
      if (["completed", "failed", "busy", "no-answer", "canceled"].includes(call.status)) {
        break;
      }
    }

    const [s] = await db
      .select()
      .from(sdrCallSessions)
      .where(eq(sdrCallSessions.id, session.id));
    if (s?.transcript || s?.status === "completed") {
      console.log("DB session update:", {
        status: s.status,
        outcome: s.outcome,
        transcriptPreview: (s.transcript || "").slice(0, 240),
        summary: s.aiSummary,
        streamSid: s.twilioStreamSid,
      });
      if (s.status === "completed" && lastTwilioStatus && ["completed", "failed", "busy", "no-answer", "canceled"].includes(lastTwilioStatus)) {
        break;
      }
    }

    await sleep(3000);
  }

  const [finalSession] = await db
    .select()
    .from(sdrCallSessions)
    .where(eq(sdrCallSessions.id, session.id));
  const [finalEnroll] = await db
    .select()
    .from(sdrEnrollments)
    .where(eq(sdrEnrollments.id, enrollment.id));

  console.log("\n=== RESULT ===");
  console.log("Enrollment:", finalEnroll.status);
  console.log("Session status/outcome:", finalSession?.status, finalSession?.outcome);
  console.log("Stream SID:", finalSession?.twilioStreamSid);
  console.log("Transcript:\n", finalSession?.transcript || "(empty)");
  console.log("AI summary:", finalSession?.aiSummary || "(none)");
  console.log("Recording URL:", finalSession?.recordingUrl || "(none)");

  if (finalSession?.twilioCallSid) {
    const call = await client.calls(finalSession.twilioCallSid).fetch();
    console.log("Final Twilio:", {
      status: call.status,
      duration: call.duration,
      answeredBy: (call as any).answeredBy,
      direction: call.direction,
    });
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("LIVE CALL TEST FAILED:", e);
  process.exit(1);
});
