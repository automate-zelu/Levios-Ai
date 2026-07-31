import { sql, relations } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  integer,
  serial,
  boolean,
  uuid,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── USERS ─────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  // "user" = regular client, "admin" = Leviosai operator (platform-wide access)
  role: text("role").notNull().default("user"),
  organizationId: integer("organization_id").references(() => organizations.id),
  // SDR onboarding wizard completed (plan §13.4).
  // Defaults true so existing accounts skip the wizard; register sets false.
  onboardingComplete: boolean("onboarding_complete").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

// ─── ORGANIZATIONS ──────────────────────────────────────────────────────────

export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripePriceId: text("stripe_price_id"),
  plan: text("plan").notNull().default("free"),
  industry: text("industry"),
  product: text("product").default("reviiv"),
  monthlyBudgetCents: integer("monthly_budget_cents"),
  dailyBudgetCents: integer("daily_budget_cents"),
  costPerAppointmentCents: integer("cost_per_appointment_cents"),
  reactorEnabled: boolean("reactor_enabled").default(false),
  reactorConfig: text("reactor_config"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const organizationsRelations = relations(organizations, ({ many }) => ({
  leads: many(leads),
}));

// ─── LEADS ──────────────────────────────────────────────────────────────────

export type LeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "proposal"
  | "won"
  | "lost";
export type LeadTemperature = "hot" | "warm" | "cold";

export const leads = pgTable("leads", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  source: text("source"),
  status: text("status").notNull().default("new"),
  aiScore: integer("ai_score"),
  aiTemperature: text("ai_temperature"),
  aiObjection: text("ai_objection"),
  reactorState: text("reactor_state").default("new"),
  consentStatus: text("consent_status"),
  dncClean: boolean("dnc_clean"),
  /** IANA timezone for TCPA quiet hours (e.g. America/New_York). */
  timezone: text("timezone"),
  sentimentScore: integer("sentiment_score"),
  outreachAttempts: integer("outreach_attempts").default(0),
  nextOutreachAt: timestamp("next_outreach_at"),
  lastAgentId: text("last_agent_id"),
  customFields: text("custom_fields"),
  lastContactedAt: timestamp("last_contacted_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const leadsRelations = relations(leads, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [leads.organizationId],
    references: [organizations.id],
  }),
  leadMessages: many(leadMessages),
  appointments: many(appointments),
  proposals: many(proposals),
}));

// ─── LEAD MESSAGES ──────────────────────────────────────────────────────────

export type MessageChannel = "sms" | "email";
export type MessageStatus = "pending" | "sent" | "delivered" | "failed";

export const leadMessages = pgTable("lead_messages", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leads.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull().default("pending"),
  direction: text("direction").notNull().default("outbound"),
  aiGenerated: boolean("ai_generated").default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const leadMessagesRelations = relations(leadMessages, ({ one }) => ({
  lead: one(leads, {
    fields: [leadMessages.leadId],
    references: [leads.id],
  }),
}));

// ─── APPOINTMENTS ───────────────────────────────────────────────────────────

export const appointments = pgTable("appointments", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leads.id, { onDelete: "cascade" }),
  calendarEventId: text("calendar_event_id"),
  /** google | outlook — set when synced to an external calendar */
  calendarProvider: text("calendar_provider"),
  title: text("title").notNull(),
  scheduledAt: timestamp("scheduled_at").notNull(),
  status: text("status").notNull().default("scheduled"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const appointmentsRelations = relations(appointments, ({ one }) => ({
  lead: one(leads, {
    fields: [appointments.leadId],
    references: [leads.id],
  }),
}));

// ─── CAMPAIGNS ──────────────────────────────────────────────────────────────

export const campaigns = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("draft"),
  targetCount: integer("target_count").default(0),
  sentCount: integer("sent_count").default(0),
  repliedCount: integer("replied_count").default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ─── PROPOSALS ──────────────────────────────────────────────────────────────

export const proposals = pgTable("proposals", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leads.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  pdfUrl: text("pdf_url"),
  amount: integer("amount"),
  viewedAt: timestamp("viewed_at"),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const proposalsRelations = relations(proposals, ({ one }) => ({
  lead: one(leads, {
    fields: [proposals.leadId],
    references: [leads.id],
  }),
}));

// ─── ACTIVITY LOGS ──────────────────────────────────────────────────────────

export const activityLogs = pgTable("activity_logs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  action: text("action").notNull(),
  details: text("details"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ─── REACTOR: LEAD STATE LOG ────────────────────────────────────────────────

export const leadStateLog = pgTable("lead_state_log", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(() => organizations.id),
  fromState: text("from_state").notNull(),
  toState: text("to_state").notNull(),
  reason: text("reason"),
  agentId: text("agent_id"),
  eventId: text("event_id"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ─── REACTOR: BUDGET LEDGER ─────────────────────────────────────────────────

export const budgetLedger = pgTable("budget_ledger", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  agentId: text("agent_id").notNull(),
  eventId: text("event_id"),
  actionType: text("action_type").notNull(),
  costCents: integer("cost_cents").notNull(),
  dailyDate: text("daily_date").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ─── REACTOR: EVENT LOG ─────────────────────────────────────────────────────

export const reactorEventLog = pgTable("reactor_event_log", {
  id: serial("id").primaryKey(),
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  organizationId: integer("organization_id"),
  leadId: integer("lead_id"),
  payload: text("payload"),
  agentResults: text("agent_results"),
  status: text("status").notNull().default("processed"),
  processingMs: integer("processing_ms"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ─── REACTOR: INDUSTRY PRICING ──────────────────────────────────────────────

export const industryPricing = pgTable("industry_pricing", {
  id: serial("id").primaryKey(),
  industry: text("industry").notNull().unique(),
  reviivCentsPerAppt: integer("reviiv_cents_per_appt").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ─── ORG SETTINGS (JSON blob for feature toggles & preferences) ─────────────
// Schema-less key/value store so we can add new toggles without migrations.
export const orgSettings = pgTable("org_settings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull().unique(),
  settings: text("settings").notNull().default("{}"), // JSON stringified
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ─── CALENDAR CONNECTIONS (Google / Outlook OAuth — Module 10) ───────────────
export const calendarConnections = pgTable("calendar_connections", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  /** google | outlook */
  provider: text("provider").notNull(),
  accountEmail: text("account_email"),
  /** AES-encrypted access token */
  accessToken: text("access_token").notNull(),
  /** AES-encrypted refresh token */
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  calendarId: text("calendar_id").notNull().default("primary"),
  scopes: text("scopes"),
  connectedAt: timestamp("connected_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type CalendarConnection = typeof calendarConnections.$inferSelect;

// ─── GMAIL CONNECTIONS (BYOT — send SDR email from user's Gmail) ─────────────
export const gmailConnections = pgTable("gmail_connections", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .unique()
    .references(() => organizations.id, { onDelete: "cascade" }),
  accountEmail: text("account_email"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  scopes: text("scopes"),
  connectedAt: timestamp("connected_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type GmailConnection = typeof gmailConnections.$inferSelect;

// ─── INSERT SCHEMAS ─────────────────────────────────────────────────────────

export const insertOrganizationSchema = createInsertSchema(organizations).omit({
  id: true,
  createdAt: true,
});
export const insertLeadSchema = createInsertSchema(leads).omit({
  id: true,
  createdAt: true,
});
export const insertLeadMessageSchema = createInsertSchema(leadMessages).omit({
  id: true,
  createdAt: true,
});
export const insertAppointmentSchema = createInsertSchema(appointments).omit({
  id: true,
  createdAt: true,
});
export const insertCampaignSchema = createInsertSchema(campaigns).omit({
  id: true,
  createdAt: true,
});
export const insertProposalSchema = createInsertSchema(proposals).omit({
  id: true,
  createdAt: true,
});
export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({
  id: true,
  createdAt: true,
});
export const insertLeadStateLogSchema = createInsertSchema(leadStateLog).omit({
  id: true,
  createdAt: true,
});
export const insertBudgetLedgerSchema = createInsertSchema(budgetLedger).omit({
  id: true,
  createdAt: true,
});
export const insertReactorEventLogSchema = createInsertSchema(reactorEventLog).omit({
  id: true,
  createdAt: true,
});
export const insertIndustryPricingSchema = createInsertSchema(industryPricing).omit({
  id: true,
  createdAt: true,
});

// ─── TYPES ──────────────────────────────────────────────────────────────────

export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Lead = typeof leads.$inferSelect;
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type LeadMessage = typeof leadMessages.$inferSelect;
export type InsertLeadMessage = z.infer<typeof insertLeadMessageSchema>;
export type Appointment = typeof appointments.$inferSelect;
export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;
export type Campaign = typeof campaigns.$inferSelect;
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Proposal = typeof proposals.$inferSelect;
export type InsertProposal = z.infer<typeof insertProposalSchema>;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type LeadStateLogEntry = typeof leadStateLog.$inferSelect;
export type InsertLeadStateLog = z.infer<typeof insertLeadStateLogSchema>;
export type BudgetLedgerEntry = typeof budgetLedger.$inferSelect;
export type InsertBudgetLedger = z.infer<typeof insertBudgetLedgerSchema>;
export type ReactorEventLogEntry = typeof reactorEventLog.$inferSelect;
export type InsertReactorEventLog = z.infer<typeof insertReactorEventLogSchema>;
export type IndustryPricingEntry = typeof industryPricing.$inferSelect;
export type InsertIndustryPricing = z.infer<typeof insertIndustryPricingSchema>;

// ─── SDR: WORKSPACES ─────────────────────────────────────────────────────────
// One workspace per organization. Holds SDR billing tier and monthly usage.

export const workspaces = pgTable("workspaces", {
  id:                    uuid("id").defaultRandom().primaryKey(),
  organizationId:        integer("organization_id").notNull().unique().references(() => organizations.id),
  name:                  text("name").notNull(),
  tier:                  text("tier").notNull().default("starter"),
  // tier values: starter | growth | scale | enterprise
  stripeCustomerId:      text("stripe_customer_id"),
  stripeSubscriptionId:  text("stripe_subscription_id"),
  monthlyLeadLimit:      integer("monthly_lead_limit").notNull().default(500),
  monthlyLeadsUsed:      integer("monthly_leads_used").notNull().default(0),
  monthlyMinuteLimit:    integer("monthly_minute_limit").notNull().default(1000),
  monthlyMinutesUsed:    integer("monthly_minutes_used").notNull().default(0),
  seatLimit:             integer("seat_limit").notNull().default(5),
  // isActive defaults false — Stripe webhook activates after successful subscription
  isActive:              boolean("is_active").notNull().default(false),
  // Twilio sub-account — provisioned on subscription.created (see lib/twilio-subaccount.ts)
  // Both SID and auth token are AES-256-CBC encrypted via lib/crypto.ts before storage.
  twilioSubAccountSid:   text("twilio_sub_account_sid"),   // encrypted ACxxx
  twilioSubAuthToken:    text("twilio_sub_auth_token"),    // encrypted
  twilioPhoneNumber:     text("twilio_phone_number"),      // plain +15551234567
  twilioPhoneSid:        text("twilio_phone_sid"),         // PNxxx — used for release
  createdAt:             timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt:             timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertWorkspaceSchema = createInsertSchema(workspaces).omit({ id: true, createdAt: true, updatedAt: true });
export type Workspace = typeof workspaces.$inferSelect;
export type InsertWorkspace = z.infer<typeof insertWorkspaceSchema>;

// ─── SDR: CONFIGS ─────────────────────────────────────────────────────────────
// Per-workspace SDR configuration — prompt, templates, thresholds.

export const sdrConfigs = pgTable("sdr_configs", {
  id:                uuid("id").defaultRandom().primaryKey(),
  workspaceId:       uuid("workspace_id").notNull().unique().references(() => workspaces.id),
  assistantName:     text("assistant_name"),
  assistantVoiceId:  text("assistant_voice_id"),
  systemPrompt:      text("system_prompt").notNull(),
  knowledgeBase:     text("knowledge_base"),
  smsTemplate:       text("sms_template").notNull(),
  emailSubject:      text("email_subject").notNull(),
  emailBody:         text("email_body").notNull(),
  dormantDays:       integer("dormant_days").notNull().default(7),
  waitCallHrs:       integer("wait_call_hrs").notNull().default(2),
  waitSmsHrs:        integer("wait_sms_hrs").notNull().default(4),
  reEnrollDays:      integer("re_enroll_days").notNull().default(30),
  kbEmbeddedAt:      timestamp("kb_embedded_at"),
  // isActive defaults false — client must complete onboarding to activate SDR
  isActive:          boolean("is_active").notNull().default(false),
  createdAt:         timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt:         timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertSdrConfigSchema = createInsertSchema(sdrConfigs).omit({ id: true, createdAt: true, updatedAt: true });
export type SdrConfig = typeof sdrConfigs.$inferSelect;
export type InsertSdrConfig = z.infer<typeof insertSdrConfigSchema>;

// ─── SDR: ENROLLMENTS ─────────────────────────────────────────────────────────
// Tracks each lead's journey through the SDR sequence.

export type EnrollmentStatus =
  | "pending"
  | "call_initiated"
  | "call_connected"
  | "call_answered"
  | "call_no_answer"
  | "call_busy"
  | "call_failed"
  | "sms_sent"
  | "sms_replied"
  | "email_sent"
  | "email_replied"
  | "booked"
  | "exhausted"
  | "re_enrolled";

export const sdrEnrollments = pgTable("sdr_enrollments", {
  id:              uuid("id").defaultRandom().primaryKey(),
  workspaceId:     uuid("workspace_id").notNull().references(() => workspaces.id),
  leadId:          integer("lead_id").notNull().references(() => leads.id),
  status:          text("status").notNull().default("pending"),
  currentStep:     integer("current_step").notNull().default(1),
  callAttempts:    integer("call_attempts").notNull().default(0),
  enrolledAt:      timestamp("enrolled_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  callInitiatedAt: timestamp("call_initiated_at"),
  smsSentAt:       timestamp("sms_sent_at"),
  emailSentAt:     timestamp("email_sent_at"),
  exhaustedAt:     timestamp("exhausted_at"),
  nextEnrollAfter: timestamp("next_enroll_after"),
  callSessionId:   uuid("call_session_id"),
  bullmqJobId:     text("bullmq_job_id"),
  createdAt:       timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt:       timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertSdrEnrollmentSchema = createInsertSchema(sdrEnrollments).omit({ id: true, createdAt: true, updatedAt: true });
export type SdrEnrollment = typeof sdrEnrollments.$inferSelect;
export type InsertSdrEnrollment = z.infer<typeof insertSdrEnrollmentSchema>;

// ─── SDR: LOGS ────────────────────────────────────────────────────────────────
// Step-by-step audit trail for every SDR sequence action.

export const sdrLogs = pgTable("sdr_logs", {
  id:            uuid("id").defaultRandom().primaryKey(),
  workspaceId:   uuid("workspace_id").notNull().references(() => workspaces.id),
  enrollmentId:  uuid("enrollment_id").notNull().references(() => sdrEnrollments.id),
  leadId:        integer("lead_id").notNull().references(() => leads.id),
  step:          integer("step").notNull(),
  stepName:      text("step_name"),
  // call_initiated | call_answered | call_no_answer | sms_sent |
  // sms_replied | sms_timeout | email_sent | email_replied | email_timeout | exhausted
  outcome:       text("outcome"),
  payload:       jsonb("payload"),
  errorMessage:  text("error_message"),
  loggedAt:      timestamp("logged_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertSdrLogSchema = createInsertSchema(sdrLogs).omit({ id: true, loggedAt: true });
export type SdrLog = typeof sdrLogs.$inferSelect;
export type InsertSdrLog = z.infer<typeof insertSdrLogSchema>;

// ─── SDR: CALL SESSIONS ───────────────────────────────────────────────────────
// Per-call data: Twilio SID, transcript, recording, outcome. Populated in Module 2.

export const sdrCallSessions = pgTable("sdr_call_sessions", {
  id:              uuid("id").defaultRandom().primaryKey(),
  workspaceId:     uuid("workspace_id").notNull().references(() => workspaces.id),
  enrollmentId:    uuid("enrollment_id").references(() => sdrEnrollments.id),
  leadId:          integer("lead_id").references(() => leads.id),
  twilioCallSid:   text("twilio_call_sid"),
  twilioStreamSid: text("twilio_stream_sid"),
  status:          text("status"),
  // completed | no-answer | busy | failed | voicemail
  durationSeconds: integer("duration_seconds"),
  recordingUrl:    text("recording_url"),
  transcript:      text("transcript"),
  aiSummary:       text("ai_summary"),
  outcome:         text("outcome"),
  // booked | qualified | answered | no_answer | voicemail | busy | failed
  /** ISO slot extracted when outcome=booked (Module 10) */
  bookedScheduledAt: timestamp("booked_scheduled_at"),
  startedAt:       timestamp("started_at"),
  endedAt:         timestamp("ended_at"),
  createdAt:       timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertSdrCallSessionSchema = createInsertSchema(sdrCallSessions).omit({ id: true, createdAt: true });
export type SdrCallSession = typeof sdrCallSessions.$inferSelect;
export type InsertSdrCallSession = z.infer<typeof insertSdrCallSessionSchema>;
