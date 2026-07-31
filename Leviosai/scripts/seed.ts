import "dotenv/config";
import { db } from "../lib/db.js";
import {
  organizations,
  leads,
  leadMessages,
  appointments,
  campaigns,
  proposals,
  activityLogs,
} from "../lib/schema.js";
import { checkDatabaseConnection, closeDatabaseConnection } from "../lib/db.js";

async function seed() {
  console.log("🌱 Seeding Leviosai database...\n");

  const dbOk = await checkDatabaseConnection();
  if (!dbOk) {
    console.error("Cannot seed without database connection.");
    process.exit(1);
  }

  // Clear existing data (order matters due to foreign keys)
  console.log("  Clearing existing data...");
  await db.delete(activityLogs);
  await db.delete(proposals);
  await db.delete(appointments);
  await db.delete(leadMessages);
  await db.delete(leads);
  await db.delete(campaigns);
  await db.delete(organizations);

  // Organizations
  console.log("  Creating organizations...");
  const [org1, org2, org3, org4, org5, org6, org7, org8] = await db
    .insert(organizations)
    .values([
      { name: "TechCorp" },
      { name: "InnovateCo" },
      { name: "StartupXYZ" },
      { name: "Enterprise Net" },
      { name: "GlobalFirm" },
      { name: "LocalShop" },
      { name: "DesignStudio" },
      { name: "CloudServ" },
    ])
    .returning();

  // Leads
  console.log("  Creating leads...");
  const insertedLeads = await db
    .insert(leads)
    .values([
      {
        organizationId: org1.id,
        firstName: "Sarah",
        lastName: "Chen",
        email: "sarah@techcorp.io",
        phone: "+15550101",
        source: "Website",
        status: "qualified",
        aiScore: 92,
        aiTemperature: "hot",
        aiObjection: "Budget timing concerns",
        lastContactedAt: new Date("2026-02-15T10:00:00Z"),
      },
      {
        organizationId: org2.id,
        firstName: "Marcus",
        lastName: "Johnson",
        email: "marcus@innovate.co",
        phone: "+15550102",
        source: "LinkedIn",
        status: "proposal",
        aiScore: 87,
        aiTemperature: "hot",
        aiObjection: "Needs stakeholder buy-in",
        lastContactedAt: new Date("2026-02-14T14:00:00Z"),
      },
      {
        organizationId: org3.id,
        firstName: "Emily",
        lastName: "Rodriguez",
        email: "emily@startupxyz.com",
        phone: "+15550103",
        source: "Referral",
        status: "contacted",
        aiScore: 74,
        aiTemperature: "warm",
        aiObjection: "Comparing alternatives",
        lastContactedAt: new Date("2026-02-13T16:00:00Z"),
      },
      {
        organizationId: org4.id,
        firstName: "James",
        lastName: "Park",
        email: "james@enterprise.net",
        phone: "+15550104",
        source: "Cold Outreach",
        status: "new",
        aiScore: 61,
        aiTemperature: "warm",
        aiObjection: null,
        lastContactedAt: null,
      },
      {
        organizationId: org5.id,
        firstName: "Aisha",
        lastName: "Patel",
        email: "aisha@globalfirm.com",
        phone: "+15550105",
        source: "Webinar",
        status: "qualified",
        aiScore: 83,
        aiTemperature: "hot",
        aiObjection: "Implementation timeline",
        lastContactedAt: new Date("2026-02-16T09:00:00Z"),
      },
      {
        organizationId: org6.id,
        firstName: "Tom",
        lastName: "Williams",
        email: "tom@localshop.co",
        phone: "+15550106",
        source: "Website",
        status: "new",
        aiScore: 45,
        aiTemperature: "cold",
        aiObjection: null,
        lastContactedAt: null,
      },
      {
        organizationId: org7.id,
        firstName: "Lina",
        lastName: "Nakamura",
        email: "lina@designstudio.jp",
        phone: "+15550107",
        source: "Event",
        status: "won",
        aiScore: 98,
        aiTemperature: "hot",
        aiObjection: null,
        lastContactedAt: new Date("2026-02-10T11:00:00Z"),
      },
      {
        organizationId: org8.id,
        firstName: "David",
        lastName: "Kim",
        email: "david@cloudserv.io",
        phone: "+15550108",
        source: "LinkedIn",
        status: "lost",
        aiScore: 32,
        aiTemperature: "cold",
        aiObjection: "Went with competitor",
        lastContactedAt: new Date("2026-02-08T14:00:00Z"),
      },
    ])
    .returning();

  // Messages
  console.log("  Creating messages...");
  await db.insert(leadMessages).values([
    {
      leadId: insertedLeads[0].id,
      channel: "email",
      content:
        "Hi Sarah, following up on our conversation about streamlining your sales pipeline. Would love to schedule a quick demo.",
      status: "delivered",
      direction: "outbound",
      aiGenerated: true,
    },
    {
      leadId: insertedLeads[0].id,
      channel: "email",
      content: "Thanks! I'd love to learn more. Can we schedule a call this week?",
      status: "delivered",
      direction: "inbound",
      aiGenerated: false,
    },
    {
      leadId: insertedLeads[1].id,
      channel: "sms",
      content:
        "Marcus, your proposal is ready for review. Let me know if you have questions!",
      status: "delivered",
      direction: "outbound",
      aiGenerated: true,
    },
    {
      leadId: insertedLeads[1].id,
      channel: "sms",
      content: "Got it, reviewing now. Looks great so far!",
      status: "delivered",
      direction: "inbound",
      aiGenerated: false,
    },
    {
      leadId: insertedLeads[4].id,
      channel: "email",
      content:
        "Hi Aisha, great meeting at the webinar! I think Leviosai could help GlobalFirm automate your lead follow-ups.",
      status: "delivered",
      direction: "outbound",
      aiGenerated: true,
    },
  ]);

  // Appointments
  console.log("  Creating appointments...");
  await db.insert(appointments).values([
    {
      leadId: insertedLeads[0].id,
      title: "Discovery Call - Sarah Chen",
      scheduledAt: new Date("2026-02-18T14:00:00Z"),
      status: "scheduled",
    },
    {
      leadId: insertedLeads[1].id,
      title: "Proposal Review - Marcus Johnson",
      scheduledAt: new Date("2026-02-19T10:00:00Z"),
      status: "scheduled",
    },
    {
      leadId: insertedLeads[4].id,
      title: "Demo - Aisha Patel",
      scheduledAt: new Date("2026-02-20T15:00:00Z"),
      status: "scheduled",
    },
    {
      leadId: insertedLeads[6].id,
      title: "Onboarding - Lina Nakamura",
      scheduledAt: new Date("2026-02-17T09:00:00Z"),
      status: "completed",
    },
  ]);

  // Campaigns
  console.log("  Creating campaigns...");
  await db.insert(campaigns).values([
    {
      name: "Q1 Enterprise Push",
      description: "Target enterprise accounts for Q1 revenue goals",
      status: "active",
      targetCount: 150,
      sentCount: 120,
      repliedCount: 34,
    },
    {
      name: "Webinar Follow-up",
      description: "Follow up with Feb webinar attendees",
      status: "active",
      targetCount: 80,
      sentCount: 80,
      repliedCount: 22,
    },
    {
      name: "Re-engagement Campaign",
      description: "Re-engage cold leads from Q4 2025",
      status: "draft",
      targetCount: 200,
      sentCount: 0,
      repliedCount: 0,
    },
  ]);

  // Proposals
  console.log("  Creating proposals...");
  await db.insert(proposals).values([
    {
      leadId: insertedLeads[1].id,
      title: "InnovateCo Growth Package",
      amount: 24000,
      status: "sent",
      viewedAt: new Date("2026-02-15T10:00:00Z"),
    },
    {
      leadId: insertedLeads[4].id,
      title: "GlobalFirm Enterprise Plan",
      amount: 48000,
      status: "draft",
    },
    {
      leadId: insertedLeads[6].id,
      title: "DesignStudio Starter",
      amount: 12000,
      status: "accepted",
      viewedAt: new Date("2026-02-09T14:00:00Z"),
    },
  ]);

  // Activity logs
  console.log("  Creating activity logs...");
  await db.insert(activityLogs).values([
    { entityType: "lead", entityId: insertedLeads[0].id, action: "created", details: "Lead Sarah Chen created from Website" },
    { entityType: "lead", entityId: insertedLeads[0].id, action: "ai_scored", details: "AI Score: 92, Temperature: hot" },
    { entityType: "lead", entityId: insertedLeads[1].id, action: "proposal_sent", details: "InnovateCo Growth Package ($24,000)" },
    { entityType: "lead", entityId: insertedLeads[6].id, action: "deal_won", details: "DesignStudio Starter ($12,000) accepted" },
    { entityType: "campaign", entityId: 1, action: "launched", details: "Q1 Enterprise Push started" },
  ]);

  console.log("\n✅ Seed complete!");
  console.log(`   • 8 organizations`);
  console.log(`   • 8 leads`);
  console.log(`   • 5 messages`);
  console.log(`   • 4 appointments`);
  console.log(`   • 3 campaigns`);
  console.log(`   • 3 proposals`);
  console.log(`   • 5 activity logs\n`);

  await closeDatabaseConnection();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
