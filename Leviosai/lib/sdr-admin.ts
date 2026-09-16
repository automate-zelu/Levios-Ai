// ─── SDR ADMIN DATA SERVICE ───────────────────────────────────────────────────
// Cross-workspace data access functions for the Leviosai operator admin panel.
// These functions bypass workspace scoping intentionally — they are only ever
// called from routes protected by the requireAdmin middleware.

import { db } from "./db.js";
import { workspaces, sdrConfigs, sdrEnrollments, organizations, sdrCallSessions } from "./schema.js";
import { eq, sql, desc, count, and, gte, lte } from "drizzle-orm";
import { getTierLimits, isSdrTier, type SdrTier } from "./tiers.js";
import { ensureTestCreditColumn } from "./schema-ensure.js";
import { filterUsageAlerts, ADMIN_USAGE_ALERT_RATIO } from "./admin-helpers.js";

// ─── WORKSPACE LIST ───────────────────────────────────────────────────────────

export async function listAllWorkspaces() {
  const rows = await db
    .select({
      id:                 workspaces.id,
      organizationId:     workspaces.organizationId,
      name:               workspaces.name,
      tier:               workspaces.tier,
      isActive:           workspaces.isActive,
      monthlyLeadsUsed:   workspaces.monthlyLeadsUsed,
      monthlyLeadLimit:   workspaces.monthlyLeadLimit,
      monthlyMinutesUsed: workspaces.monthlyMinutesUsed,
      monthlyMinuteLimit: workspaces.monthlyMinuteLimit,
      seatLimit:          workspaces.seatLimit,
      createdAt:          workspaces.createdAt,
      twilioPhoneNumber:  workspaces.twilioPhoneNumber,
    })
    .from(workspaces)
    .orderBy(desc(workspaces.createdAt));

  const lastRows = await db
    .select({
      workspaceId: workspaces.id,
      lastEnrollmentAt: sql<Date | null>`max(${sdrEnrollments.createdAt})`,
    })
    .from(workspaces)
    .leftJoin(sdrEnrollments, eq(sdrEnrollments.workspaceId, workspaces.id))
    .groupBy(workspaces.id);

  const lastMap = new Map(lastRows.map((r) => [r.workspaceId, r.lastEnrollmentAt]));

  return rows.map((w) => ({
    ...w,
    lastEnrollmentAt: lastMap.get(w.id) ?? null,
  }));
}

/** Workspaces at ≥90% of lead or minute limit (plan §11.4 Usage Alerts). */
export async function listUsageAlerts(threshold = ADMIN_USAGE_ALERT_RATIO) {
  const all = await listAllWorkspaces();
  return filterUsageAlerts(all, threshold);
}

// ─── WORKSPACE DETAIL ─────────────────────────────────────────────────────────

export async function getWorkspaceDetail(workspaceId: string) {
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));

  if (!workspace) return null;

  const [config] = await db
    .select()
    .from(sdrConfigs)
    .where(eq(sdrConfigs.workspaceId, workspaceId));

  const [{ total }] = await db
    .select({ total: count() })
    .from(sdrEnrollments)
    .where(eq(sdrEnrollments.workspaceId, workspaceId));

  const [{ booked }] = await db
    .select({ booked: count() })
    .from(sdrEnrollments)
    .where(and(
      eq(sdrEnrollments.workspaceId, workspaceId),
      eq(sdrEnrollments.status, "booked")
    ));

  const [org] = workspace.organizationId
    ? await db.select().from(organizations).where(eq(organizations.id, workspace.organizationId))
    : [null];

  let commercialPricing = null;
  let recentCharges: any[] = [];
  let platformDefaults = null;
  if (org) {
    const {
      getOrgCommercialPricing,
      getPlatformCommercialDefaults,
      listRecentAppointmentCharges,
    } = await import("./commercial-pricing-service.js");
    commercialPricing = await getOrgCommercialPricing(org.id);
    platformDefaults = await getPlatformCommercialDefaults();
    recentCharges = await listRecentAppointmentCharges(org.id, 10);
  }

  return {
    workspace,
    organization: org
      ? {
          id: org.id,
          name: org.name,
          plan: org.plan,
          stripeSubscriptionId: org.stripeSubscriptionId,
          costPerAppointmentCents: org.costPerAppointmentCents,
          monthlyFeeEnabled: org.monthlyFeeEnabled,
          monthlyFeeOverrideCents: org.monthlyFeeOverrideCents,
          appointmentFeeEnabled: org.appointmentFeeEnabled,
        }
      : null,
    commercialPricing,
    platformDefaults,
    recentCharges,
    sdrConfig: config
      ? {
          id: config.id,
          isActive: config.isActive,
          dormantDays: config.dormantDays,
          waitCallHrs: config.waitCallHrs,
          waitSmsHrs: config.waitSmsHrs,
          reEnrollDays: config.reEnrollDays,
          assistantName: config.assistantName,
          updatedAt: config.updatedAt,
        }
      : null,
    enrollmentStats: {
      total: Number(total),
      booked: Number(booked),
      bookedRate: total > 0 ? Math.round((Number(booked) / Number(total)) * 100) : 0,
    },
  };
}

export async function getWorkspaceEnrollments(
  workspaceId: string,
  opts: { status?: string; page?: number; limit?: number } = {}
) {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, opts.limit ?? 25);
  const offset = (page - 1) * limit;

  const conditions = [eq(sdrEnrollments.workspaceId, workspaceId)];
  if (opts.status) conditions.push(eq(sdrEnrollments.status, opts.status));
  const where = and(...conditions);

  const rows = await db
    .select()
    .from(sdrEnrollments)
    .where(where)
    .orderBy(desc(sdrEnrollments.updatedAt))
    .limit(limit)
    .offset(offset);

  const [{ total }] = await db
    .select({ total: count() })
    .from(sdrEnrollments)
    .where(where);

  return {
    data: rows,
    total: Number(total),
    page,
    limit,
    pages: Math.ceil(Number(total) / limit) || 1,
  };
}

// ─── ACTIVATE / DEACTIVATE ────────────────────────────────────────────────────

export async function setWorkspaceActive(workspaceId: string, isActive: boolean) {
  const [updated] = await db
    .update(workspaces)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId))
    .returning();
  return updated;
}

// ─── TIER CHANGE ──────────────────────────────────────────────────────────────

export async function changeWorkspaceTier(workspaceId: string, tier: string) {
  if (!isSdrTier(tier)) throw new Error(`Unknown tier: ${tier}`);
  const limits = getTierLimits(tier as SdrTier);

  const [updated] = await db
    .update(workspaces)
    .set({
      tier,
      monthlyLeadLimit: limits.monthlyLeadLimit,
      monthlyMinuteLimit: limits.monthlyMinuteLimit,
      seatLimit: limits.seatLimit,
      updatedAt: new Date(),
    })
    .where(eq(workspaces.id, workspaceId))
    .returning();
  return updated;
}

// ─── RESET MONTHLY USAGE ──────────────────────────────────────────────────────

export async function resetWorkspaceUsage(workspaceId: string) {
  await ensureTestCreditColumn();
  const [updated] = await db
    .update(workspaces)
    .set({ monthlyLeadsUsed: 0, monthlyMinutesUsed: 0, monthlyTestMinutesUsed: 0, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId))
    .returning();
  return updated;
}

// ─── PLATFORM ANALYTICS ───────────────────────────────────────────────────────

export async function getPlatformAnalytics(dateRange?: { startDate?: Date; endDate?: Date }) {
  const [{ totalWorkspaces }] = await db
    .select({ totalWorkspaces: count() })
    .from(workspaces);

  const [{ activeWorkspaces }] = await db
    .select({ activeWorkspaces: count() })
    .from(workspaces)
    .where(eq(workspaces.isActive, true));

  const enrollmentConditions = [];
  if (dateRange?.startDate) enrollmentConditions.push(gte(sdrEnrollments.createdAt, dateRange.startDate));
  if (dateRange?.endDate) enrollmentConditions.push(lte(sdrEnrollments.createdAt, dateRange.endDate));

  const enrollmentBase = db.select({ totalEnrollments: count() }).from(sdrEnrollments);
  const [{ totalEnrollments }] = enrollmentConditions.length
    ? await enrollmentBase.where(and(...enrollmentConditions))
    : await enrollmentBase;

  const bookedConditions = [eq(sdrEnrollments.status, "booked"), ...enrollmentConditions];
  const [{ totalBooked }] = await db
    .select({ totalBooked: count() })
    .from(sdrEnrollments)
    .where(and(...bookedConditions));

  const callConditions = [];
  if (dateRange?.startDate) callConditions.push(gte(sdrCallSessions.startedAt, dateRange.startDate));
  if (dateRange?.endDate) callConditions.push(lte(sdrCallSessions.startedAt, dateRange.endDate));

  const callBase = db.select({ totalCalls: count() }).from(sdrCallSessions);
  const [{ totalCalls }] = callConditions.length
    ? await callBase.where(and(...callConditions))
    : await callBase;

  const answeredConditions = [
    sql`${sdrCallSessions.outcome} in ('booked', 'qualified', 'answered', 'interested')`,
    ...callConditions,
  ];
  const [{ answeredCalls }] = await db
    .select({ answeredCalls: count() })
    .from(sdrCallSessions)
    .where(and(...answeredConditions));

  const byTier = await db
    .select({
      tier: workspaces.tier,
      enrollments: count(sdrEnrollments.id),
      workspaceCount: sql<number>`count(distinct ${workspaces.id})`,
    })
    .from(workspaces)
    .leftJoin(sdrEnrollments, eq(sdrEnrollments.workspaceId, workspaces.id))
    .groupBy(workspaces.tier);

  const usageAlerts = filterUsageAlerts(await listAllWorkspaces());

  return {
    totalWorkspaces: Number(totalWorkspaces),
    activeWorkspaces: Number(activeWorkspaces),
    totalEnrollments: Number(totalEnrollments),
    totalBooked: Number(totalBooked),
    bookedRate:
      Number(totalEnrollments) > 0
        ? Math.round((Number(totalBooked) / Number(totalEnrollments)) * 100)
        : 0,
    totalCalls: Number(totalCalls),
    answeredCalls: Number(answeredCalls),
    answerRate:
      Number(totalCalls) > 0
        ? Math.round((Number(answeredCalls) / Number(totalCalls)) * 100)
        : 0,
    enrollmentsByTier: byTier.map((r) => ({
      tier: r.tier,
      enrollments: Number(r.enrollments),
      workspaces: Number(r.workspaceCount),
    })),
    usageAlertCount: usageAlerts.length,
  };
}
