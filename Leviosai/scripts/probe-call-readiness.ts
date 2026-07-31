/**
 * Probe Twilio numbers + DB workspace state for live call testing.
 * Run: npx tsx scripts/probe-call-readiness.ts
 */
import "dotenv/config";
import twilio from "twilio";
import { db } from "../lib/db.js";
import { workspaces, sdrConfigs, leads } from "../lib/schema.js";

async function main() {
  const sid = process.env.TWILIO_MASTER_SID || process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_MASTER_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN;
  console.log("Twilio SID present:", !!sid);
  console.log("BASE_URL:", process.env.BASE_URL);
  console.log("TWILIO_PHONE_NUMBER env:", process.env.TWILIO_PHONE_NUMBER);

  if (sid && token) {
    const client = twilio(sid, token);
    const nums = await client.incomingPhoneNumbers.list({ limit: 20 });
    console.log(
      "Account phone numbers:",
      nums.map((n) => ({ phone: n.phoneNumber, sid: n.sid, voiceUrl: n.voiceUrl }))
    );
  }

  const ws = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      isActive: workspaces.isActive,
      phone: workspaces.twilioPhoneNumber,
      hasSub: workspaces.twilioSubAccountSid,
    })
    .from(workspaces);
  console.log("Workspaces:", ws);

  const cfg = await db
    .select({
      workspaceId: sdrConfigs.workspaceId,
      isActive: sdrConfigs.isActive,
      assistant: sdrConfigs.assistantName,
    })
    .from(sdrConfigs);
  console.log("SDR configs:", cfg);

  const leadRows = await db
    .select({
      id: leads.id,
      phone: leads.phone,
      email: leads.email,
      org: leads.organizationId,
      firstName: leads.firstName,
    })
    .from(leads)
    .limit(20);
  console.log("Leads sample:", leadRows);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
