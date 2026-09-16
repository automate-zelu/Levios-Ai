import { eq, desc, asc, sql, and, ilike, or } from "drizzle-orm";
import { db } from "./db.js";
import {
  organizations,
  leads,
  leadMessages,
  appointments,
  campaigns,
  proposals,
  activityLogs,
  type InsertOrganization,
  type InsertLead,
  type InsertLeadMessage,
  type InsertAppointment,
  type InsertCampaign,
  type InsertProposal,
  type InsertActivityLog,
} from "./schema.js";

// ─── ORGANIZATIONS ──────────────────────────────────────────────────────────

export const storage = {
  // Organizations
  async getOrganizations() {
    return db.select().from(organizations).orderBy(asc(organizations.name));
  },

  async getOrganization(id: number) {
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, id));
    return org || null;
  },

  async createOrganization(data: InsertOrganization) {
    const [org] = await db.insert(organizations).values(data).returning();
    return org;
  },

  // ─── LEADS (org-scoped) ────────────────────────────────────────────────

  async getLeads(filters?: { status?: string; temperature?: string; search?: string; organizationId?: number | null }) {
    let query = db
      .select({
        id: leads.id,
        organizationId: leads.organizationId,
        firstName: leads.firstName,
        lastName: leads.lastName,
        email: leads.email,
        phone: leads.phone,
        source: leads.source,
        status: leads.status,
        aiScore: leads.aiScore,
        aiTemperature: leads.aiTemperature,
        aiObjection: leads.aiObjection,
        lastContactedAt: leads.lastContactedAt,
        createdAt: leads.createdAt,
        orgName: organizations.name,
      })
      .from(leads)
      .leftJoin(organizations, eq(leads.organizationId, organizations.id))
      .orderBy(desc(leads.createdAt))
      .$dynamic();

    // Apply filters
    const conditions = [];

    // Org scoping
    if (filters?.organizationId) {
      conditions.push(eq(leads.organizationId, filters.organizationId));
    }

    if (filters?.status) conditions.push(eq(leads.status, filters.status));
    if (filters?.temperature)
      conditions.push(eq(leads.aiTemperature, filters.temperature));
    if (filters?.search) {
      conditions.push(
        or(
          ilike(leads.firstName, `%${filters.search}%`),
          ilike(leads.lastName, `%${filters.search}%`),
          ilike(leads.email, `%${filters.search}%`)
        )!
      );
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    return query;
  },

  async getLead(id: number, organizationId?: number | null) {
    const conditions = [eq(leads.id, id)];
    if (organizationId) conditions.push(eq(leads.organizationId, organizationId));

    const [lead] = await db
      .select({
        id: leads.id,
        organizationId: leads.organizationId,
        firstName: leads.firstName,
        lastName: leads.lastName,
        email: leads.email,
        phone: leads.phone,
        source: leads.source,
        status: leads.status,
        aiScore: leads.aiScore,
        aiTemperature: leads.aiTemperature,
        aiObjection: leads.aiObjection,
        lastContactedAt: leads.lastContactedAt,
        createdAt: leads.createdAt,
        orgName: organizations.name,
      })
      .from(leads)
      .leftJoin(organizations, eq(leads.organizationId, organizations.id))
      .where(and(...conditions));
    return lead || null;
  },

  async getLeadByPhone(phone: string) {
    const [lead] = await db
      .select()
      .from(leads)
      .where(eq(leads.phone, phone));
    return lead || null;
  },

  async getLeadByEmail(email: string) {
    const [lead] = await db
      .select()
      .from(leads)
      .where(eq(leads.email, email));
    return lead || null;
  },

  async createLead(data: InsertLead) {
    const [lead] = await db.insert(leads).values(data).returning();
    return lead;
  },

  async updateLead(id: number, data: Partial<InsertLead>, organizationId?: number | null) {
    const conditions = [eq(leads.id, id)];
    if (organizationId) conditions.push(eq(leads.organizationId, organizationId));

    const [lead] = await db
      .update(leads)
      .set(data)
      .where(and(...conditions))
      .returning();
    return lead;
  },

  async deleteLead(id: number, organizationId?: number | null) {
    const conditions = [eq(leads.id, id)];
    if (organizationId) conditions.push(eq(leads.organizationId, organizationId));

    await db.delete(leads).where(and(...conditions));
  },

  // Pipeline stats (org-scoped)
  async getPipelineStats(organizationId?: number | null) {
    let query = db
      .select({
        status: leads.status,
        count: sql<number>`count(*)::int`,
      })
      .from(leads)
      .groupBy(leads.status)
      .$dynamic();

    if (organizationId) {
      query = query.where(eq(leads.organizationId, organizationId));
    }

    return query;
  },

  async getLeadsByTemperature(organizationId?: number | null) {
    let query = db
      .select({
        temperature: leads.aiTemperature,
        count: sql<number>`count(*)::int`,
      })
      .from(leads)
      .groupBy(leads.aiTemperature)
      .$dynamic();

    if (organizationId) {
      query = query.where(eq(leads.organizationId, organizationId));
    }

    return query;
  },

  // ─── LEAD MESSAGES ────────────────────────────────────────────────────

  async getLeadMessages(leadId: number) {
    return db
      .select()
      .from(leadMessages)
      .where(eq(leadMessages.leadId, leadId))
      .orderBy(asc(leadMessages.createdAt));
  },

  async createLeadMessage(data: InsertLeadMessage) {
    const [msg] = await db.insert(leadMessages).values(data).returning();
    // Update lead's lastContactedAt
    await db
      .update(leads)
      .set({ lastContactedAt: new Date() })
      .where(eq(leads.id, data.leadId));
    return msg;
  },

  async getRecentMessages(limit = 20, organizationId?: number | null) {
    let query = db
      .select({
        id: leadMessages.id,
        leadId: leadMessages.leadId,
        channel: leadMessages.channel,
        content: leadMessages.content,
        status: leadMessages.status,
        direction: leadMessages.direction,
        aiGenerated: leadMessages.aiGenerated,
        createdAt: leadMessages.createdAt,
        leadFirstName: leads.firstName,
        leadLastName: leads.lastName,
      })
      .from(leadMessages)
      .leftJoin(leads, eq(leadMessages.leadId, leads.id))
      .orderBy(desc(leadMessages.createdAt))
      .limit(limit)
      .$dynamic();

    if (organizationId) {
      query = query.where(eq(leads.organizationId, organizationId));
    }

    return query;
  },

  /**
   * Inbox threads for SMS or email — one row per lead with last message preview.
   */
  async getMessageThreads(
    organizationId: number,
    channel: "sms" | "email",
    limit = 50
  ) {
    const rows = await db
      .select({
        id: leadMessages.id,
        leadId: leadMessages.leadId,
        channel: leadMessages.channel,
        content: leadMessages.content,
        status: leadMessages.status,
        direction: leadMessages.direction,
        aiGenerated: leadMessages.aiGenerated,
        createdAt: leadMessages.createdAt,
        leadFirstName: leads.firstName,
        leadLastName: leads.lastName,
        leadEmail: leads.email,
        leadPhone: leads.phone,
      })
      .from(leadMessages)
      .innerJoin(leads, eq(leadMessages.leadId, leads.id))
      .where(
        and(
          eq(leads.organizationId, organizationId),
          eq(leadMessages.channel, channel)
        )
      )
      .orderBy(desc(leadMessages.createdAt))
      .limit(Math.min(2000, Math.max(limit * 20, 200)));

    const byLead = new Map<
      number,
      {
        leadId: number;
        leadFirstName: string | null;
        leadLastName: string | null;
        leadEmail: string | null;
        leadPhone: string | null;
        lastMessage: (typeof rows)[0];
        messageCount: number;
      }
    >();

    for (const row of rows) {
      const existing = byLead.get(row.leadId);
      if (!existing) {
        byLead.set(row.leadId, {
          leadId: row.leadId,
          leadFirstName: row.leadFirstName,
          leadLastName: row.leadLastName,
          leadEmail: row.leadEmail,
          leadPhone: row.leadPhone,
          lastMessage: row,
          messageCount: 1,
        });
      } else {
        existing.messageCount += 1;
      }
    }

    return Array.from(byLead.values())
      .sort(
        (a, b) =>
          new Date(b.lastMessage.createdAt).getTime() -
          new Date(a.lastMessage.createdAt).getTime()
      )
      .slice(0, limit);
  },

  // ─── APPOINTMENTS (scoped through leads) ──────────────────────────────

  async getAppointments(filters?: { status?: string; leadId?: number; organizationId?: number | null }) {
    let query = db
      .select({
        id: appointments.id,
        leadId: appointments.leadId,
        calendarEventId: appointments.calendarEventId,
        calendarProvider: appointments.calendarProvider,
        title: appointments.title,
        scheduledAt: appointments.scheduledAt,
        status: appointments.status,
        createdAt: appointments.createdAt,
        leadFirstName: leads.firstName,
        leadLastName: leads.lastName,
        leadEmail: leads.email,
        leadPhone: leads.phone,
        orgName: organizations.name,
      })
      .from(appointments)
      .leftJoin(leads, eq(appointments.leadId, leads.id))
      .leftJoin(organizations, eq(leads.organizationId, organizations.id))
      .orderBy(asc(appointments.scheduledAt))
      .$dynamic();

    const conditions = [];
    if (filters?.organizationId) conditions.push(eq(leads.organizationId, filters.organizationId));
    if (filters?.status) conditions.push(eq(appointments.status, filters.status));
    if (filters?.leadId) conditions.push(eq(appointments.leadId, filters.leadId));
    if (conditions.length > 0) query = query.where(and(...conditions));

    return query;
  },

  async getAppointment(id: number, organizationId?: number | null) {
    const rows = await this.getAppointments({ organizationId });
    return rows.find((row) => row.id === id) ?? null;
  },

  async createAppointment(data: InsertAppointment) {
    const [appt] = await db.insert(appointments).values(data).returning();
    return appt;
  },

  async updateAppointment(id: number, data: Partial<InsertAppointment>) {
    const [appt] = await db
      .update(appointments)
      .set(data)
      .where(eq(appointments.id, id))
      .returning();
    return appt;
  },

  async deleteAppointment(id: number) {
    await db.delete(appointments).where(eq(appointments.id, id));
  },

  // ─── CAMPAIGNS (org-scoped) ───────────────────────────────────────────

  async getCampaigns(organizationId?: number | null) {
    let query = db.select().from(campaigns).orderBy(desc(campaigns.createdAt)).$dynamic();
    if (organizationId) {
      query = query.where(eq(campaigns.organizationId, organizationId));
    }
    return query;
  },

  async getCampaign(id: number, organizationId?: number | null) {
    const conditions = [eq(campaigns.id, id)];
    if (organizationId) conditions.push(eq(campaigns.organizationId, organizationId));

    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(and(...conditions));
    return campaign || null;
  },

  async createCampaign(data: InsertCampaign) {
    const [campaign] = await db.insert(campaigns).values(data).returning();
    return campaign;
  },

  async updateCampaign(id: number, data: Partial<InsertCampaign>, organizationId?: number | null) {
    const conditions = [eq(campaigns.id, id)];
    if (organizationId) conditions.push(eq(campaigns.organizationId, organizationId));

    const [campaign] = await db
      .update(campaigns)
      .set(data)
      .where(and(...conditions))
      .returning();
    return campaign;
  },

  // ─── PROPOSALS (scoped through leads) ─────────────────────────────────

  async getProposals(leadId?: number, organizationId?: number | null) {
    let query = db
      .select({
        id: proposals.id,
        leadId: proposals.leadId,
        title: proposals.title,
        pdfUrl: proposals.pdfUrl,
        amount: proposals.amount,
        viewedAt: proposals.viewedAt,
        status: proposals.status,
        createdAt: proposals.createdAt,
        leadFirstName: leads.firstName,
        leadLastName: leads.lastName,
      })
      .from(proposals)
      .leftJoin(leads, eq(proposals.leadId, leads.id))
      .orderBy(desc(proposals.createdAt))
      .$dynamic();

    const conditions = [];
    if (organizationId) conditions.push(eq(leads.organizationId, organizationId));
    if (leadId) conditions.push(eq(proposals.leadId, leadId));
    if (conditions.length > 0) query = query.where(and(...conditions));

    return query;
  },

  async createProposal(data: InsertProposal) {
    const [proposal] = await db.insert(proposals).values(data).returning();
    return proposal;
  },

  async updateProposal(id: number, data: Partial<InsertProposal>) {
    const [proposal] = await db
      .update(proposals)
      .set(data)
      .where(eq(proposals.id, id))
      .returning();
    return proposal;
  },

  async deleteProposal(id: number) {
    await db.delete(proposals).where(eq(proposals.id, id));
  },

  // ─── ACTIVITY LOGS (org-scoped) ───────────────────────────────────────

  async getActivityLogs(entityType?: string, entityId?: number, limit = 50, organizationId?: number | null) {
    let query = db
      .select()
      .from(activityLogs)
      .orderBy(desc(activityLogs.createdAt))
      .limit(limit)
      .$dynamic();

    const conditions = [];
    if (organizationId) conditions.push(eq(activityLogs.organizationId, organizationId));
    if (entityType) conditions.push(eq(activityLogs.entityType, entityType));
    if (entityId) conditions.push(eq(activityLogs.entityId, entityId));
    if (conditions.length > 0) query = query.where(and(...conditions));

    return query;
  },

  async logActivity(data: InsertActivityLog) {
    const [log] = await db.insert(activityLogs).values(data).returning();
    return log;
  },

  // ─── DASHBOARD STATS (org-scoped) ─────────────────────────────────────

  async getDashboardStats(organizationId?: number | null) {
    const orgFilter = organizationId ? eq(leads.organizationId, organizationId) : undefined;
    const orgFilterProposals = organizationId
      ? and(
          eq(leads.organizationId, organizationId),
          or(
            eq(proposals.status, "sent"),
            eq(proposals.status, "viewed"),
            eq(proposals.status, "draft")
          )
        )
      : or(
          eq(proposals.status, "sent"),
          eq(proposals.status, "viewed"),
          eq(proposals.status, "draft")
        );

    const [leadCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .where(orgFilter);

    const [hotCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .where(orgFilter ? and(orgFilter, eq(leads.aiTemperature, "hot")) : eq(leads.aiTemperature, "hot"));

    const [wonCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .where(orgFilter ? and(orgFilter, eq(leads.status, "won")) : eq(leads.status, "won"));

    const proposalQuery = db
      .select({ total: sql<number>`coalesce(sum(${proposals.amount}), 0)::int` })
      .from(proposals)
      .leftJoin(leads, eq(proposals.leadId, leads.id));

    const [proposalTotal] = organizationId
      ? await proposalQuery.where(orgFilterProposals)
      : await proposalQuery.where(
          or(
            eq(proposals.status, "sent"),
            eq(proposals.status, "viewed"),
            eq(proposals.status, "draft")
          )
        );

    const wonProposalQuery = db
      .select({ total: sql<number>`coalesce(sum(${proposals.amount}), 0)::int` })
      .from(proposals)
      .leftJoin(leads, eq(proposals.leadId, leads.id));

    const [wonTotal] = organizationId
      ? await wonProposalQuery.where(and(eq(leads.organizationId, organizationId), eq(proposals.status, "accepted")))
      : await wonProposalQuery.where(eq(proposals.status, "accepted"));

    const pipelineQuery = db
      .select({
        status: leads.status,
        count: sql<number>`count(*)::int`,
      })
      .from(leads)
      .groupBy(leads.status);

    const pipeline = orgFilter
      ? await pipelineQuery.where(orgFilter)
      : await pipelineQuery;

    let apptQuery = db
      .select({
        id: appointments.id,
        title: appointments.title,
        scheduledAt: appointments.scheduledAt,
        leadFirstName: leads.firstName,
        leadLastName: leads.lastName,
      })
      .from(appointments)
      .leftJoin(leads, eq(appointments.leadId, leads.id))
      .orderBy(asc(appointments.scheduledAt))
      .limit(5)
      .$dynamic();

    const apptConditions = [
      eq(appointments.status, "scheduled"),
      sql`${appointments.scheduledAt} >= NOW()`,
    ];
    if (organizationId) apptConditions.push(eq(leads.organizationId, organizationId));
    const upcomingAppointments = await apptQuery.where(and(...apptConditions));

    return {
      totalLeads: leadCount.count,
      hotLeads: hotCount.count,
      wonDeals: wonCount.count,
      pipelineValue: proposalTotal.total,
      wonRevenue: wonTotal.total,
      pipeline,
      upcomingAppointments,
    };
  },
};
