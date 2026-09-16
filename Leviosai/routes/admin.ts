// ─── ADMIN ROUTES ─────────────────────────────────────────────────────────────
// Cross-workspace management endpoints for Leviosai operators.
// All routes require JWT auth + role="admin" claim.
// Clients never have access to these endpoints — they are invisible in the UI
// unless req.user.role === "admin".

import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "./auth.js";
import {
  listAllWorkspaces,
  getWorkspaceDetail,
  getWorkspaceEnrollments,
  setWorkspaceActive,
  changeWorkspaceTier,
  resetWorkspaceUsage,
  getPlatformAnalytics,
  listUsageAlerts,
} from "../lib/sdr-admin.js";
import { listStuckEnrollments, recoverEnrollmentById } from "../lib/sdr-recovery.js";
import { provisionWorkspace, searchAvailableNumbers, assignPhoneNumber, releaseWorkspace, getTwilioStatus } from "../lib/twilio-subaccount.js";
import { db } from "../lib/db.js";
import { sdrEnrollments, sdrCallSessions, workspaces, users, organizations, leads } from "../lib/schema.js";
import { eq, desc, count, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { adminLimiter } from "../lib/rate-limit.js";

const router = Router();

// ─── REQUIRE ADMIN MIDDLEWARE ─────────────────────────────────────────────────
// Reads the `role` claim from the already-verified JWT (requireAuth must run first).
// Only users with role="admin" pass through.

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const role = (req as any).userRole as string | undefined;
  if (role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

// Plan §12.6 — 50 req / 15 min per admin user
router.use("/api/admin", requireAuth, requireAdmin, adminLimiter);

// ─── GET /api/admin/workspaces ────────────────────────────────────────────────

router.get("/api/admin/workspaces", async (_req: Request, res: Response) => {
  try {
    const workspaceList = await listAllWorkspaces();
    res.json(workspaceList);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/workspaces/:id ───────────────────────────────────────────

router.get("/api/admin/workspaces/:id", async (req: Request, res: Response) => {
  try {
    const detail = await getWorkspaceDetail(req.params.id as string);
    if (!detail) return res.status(404).json({ error: "Workspace not found" });
    res.json(detail);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /api/admin/workspaces/:id/status ──────────────────────────────────
// Force activate or deactivate a workspace.

router.patch("/api/admin/workspaces/:id/status", async (req: Request, res: Response) => {
  try {
    const { isActive } = req.body;
    if (typeof isActive !== "boolean") {
      return res.status(400).json({ error: "isActive must be a boolean" });
    }

    const workspace = await setWorkspaceActive(req.params.id as string, isActive);
    if (!workspace) return res.status(404).json({ error: "Workspace not found" });
    res.json(workspace);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /api/admin/workspaces/:id/tier ────────────────────────────────────
// Manual tier override — sets tier + adjusts usage limits accordingly.

router.patch("/api/admin/workspaces/:id/tier", async (req: Request, res: Response) => {
  try {
    const { tier } = req.body;
    if (!tier) return res.status(400).json({ error: "tier is required" });

    const workspace = await changeWorkspaceTier(req.params.id as string, tier);
    res.json(workspace);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ─── POST /api/admin/workspaces/:id/reset-usage ──────────────────────────────
// Reset monthly_leads_used + monthly_minutes_used to 0.

router.post("/api/admin/workspaces/:id/reset-usage", async (req: Request, res: Response) => {
  try {
    const workspace = await resetWorkspaceUsage(req.params.id as string);
    if (!workspace) return res.status(404).json({ error: "Workspace not found" });
    res.json(workspace);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/enrollments/stuck ────────────────────────────────────────
// List all enrollments stuck past their expected threshold.

router.get("/api/admin/enrollments/stuck", async (_req: Request, res: Response) => {
  try {
    const stuck = await listStuckEnrollments();
    res.json(stuck);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/admin/enrollments/:id/recover ─────────────────────────────────
// Manually trigger recovery for a single stuck enrollment.
// Uses the same recovery paths as the scheduled scan (re-queues jobs correctly).

router.post("/api/admin/enrollments/:id/recover", async (req: Request, res: Response) => {
  try {
    const enrollmentId = req.params.id as string;
    const result = await recoverEnrollmentById(enrollmentId);

    if (!result.recovered) {
      return res.status(400).json({
        error: `Enrollment could not be recovered (action=${result.action})`,
        enrollmentId,
        fromStatus: result.fromStatus,
        action: result.action,
      });
    }

    res.json({
      enrollmentId,
      fromStatus: result.fromStatus,
      action: result.action,
    });
  } catch (err: any) {
    if (err.message?.includes("not found")) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/analytics ────────────────────────────────────────────────
// Platform-wide funnel metrics across all workspaces.
// Query: ?startDate=&endDate= (ISO strings, optional)

router.get("/api/admin/analytics", async (req: Request, res: Response) => {
  try {
    const startDate = req.query.startDate ? new Date(String(req.query.startDate)) : undefined;
    const endDate = req.query.endDate ? new Date(String(req.query.endDate)) : undefined;
    const analytics = await getPlatformAnalytics({
      startDate: startDate && !Number.isNaN(startDate.getTime()) ? startDate : undefined,
      endDate: endDate && !Number.isNaN(endDate.getTime()) ? endDate : undefined,
    });
    res.json(analytics);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/usage-alerts ─────────────────────────────────────────────
// Workspaces at ≥90% of lead or minute tier limit (upsell flags).

router.get("/api/admin/usage-alerts", async (_req: Request, res: Response) => {
  try {
    const alerts = await listUsageAlerts();
    res.json(alerts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/workspaces/:id/enrollments ───────────────────────────────
// Enrollment history for a workspace (support tool).

router.get("/api/admin/workspaces/:id/enrollments", async (req: Request, res: Response) => {
  try {
    const result = await getWorkspaceEnrollments(req.params.id as string, {
      status: req.query.status as string | undefined,
      page: parseInt(String(req.query.page || "1"), 10),
      limit: parseInt(String(req.query.limit || "25"), 10),
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/workspaces/:id/twilio-status ─────────────────────────────
// Returns Twilio provisioning status for a workspace (masked SID, phone number).

router.get("/api/admin/workspaces/:id/twilio-status", async (req: Request, res: Response) => {
  try {
    const status = await getTwilioStatus(req.params.id as string);
    res.json(status);
  } catch (err: any) {
    res.status(err.message === "Workspace not found" ? 404 : 500).json({ error: err.message });
  }
});

// ─── POST /api/admin/workspaces/:id/provision-twilio ─────────────────────────
// Creates a Twilio sub-account and purchases a local phone number.
// Body: { areaCode?: string }  (defaults to "415" if omitted)

// Creates the sub-account only — no number purchased
router.post("/api/admin/workspaces/:id/provision-twilio", async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.id as string;
    const [ws] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId));
    if (!ws) return res.status(404).json({ error: "Workspace not found" });
    const result = await provisionWorkspace(workspaceId, ws.name);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Search available numbers for a workspace's sub-account (no purchase)
// Query params: ?areaCode=415&limit=10
router.get("/api/admin/workspaces/:id/available-numbers", async (req: Request, res: Response) => {
  try {
    const { areaCode = "", limit = "10" } = req.query as Record<string, string>;
    const results = await searchAvailableNumbers(req.params.id as string, areaCode, parseInt(limit, 10));
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Purchase and assign a specific number selected by admin
router.post("/api/admin/workspaces/:id/assign-number", async (req: Request, res: Response) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: "phoneNumber is required" });
    const result = await assignPhoneNumber(req.params.id as string, phoneNumber);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/admin/workspaces/:id/provision-twilio ───────────────────────
// Suspends the workspace's Twilio sub-account and clears credentials from DB.
// Used during client offboarding.

// ?permanent=true → closes the sub-account permanently (irreversible)
// default          → suspends (can be reactivated)
router.delete("/api/admin/workspaces/:id/provision-twilio", async (req: Request, res: Response) => {
  try {
    const permanent = req.query.permanent === "true";
    await releaseWorkspace(req.params.id as string, permanent);
    res.json({ ok: true, action: permanent ? "closed" : "suspended" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/users ─────────────────────────────────────────────────────
// List all users across all orgs with basic org info.

router.get("/api/admin/users", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        organizationId: users.organizationId,
        createdAt: users.createdAt,
        orgName: organizations.name,
      })
      .from(users)
      .leftJoin(organizations, eq(users.organizationId, organizations.id))
      .orderBy(desc(users.createdAt));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /api/admin/users/:id/role ─────────────────────────────────────────
// Promote or demote a user's role. body: { role: "admin" | "user" }

router.patch("/api/admin/users/:id/role", async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { role } = req.body;
    if (!["admin", "user"].includes(role)) {
      return res.status(400).json({ error: "role must be 'admin' or 'user'" });
    }
    const [updated] = await db
      .update(users)
      .set({ role })
      .where(eq(users.id, userId))
      .returning();
    if (!updated) return res.status(404).json({ error: "User not found" });
    res.json({ id: updated.id, email: updated.email, role: updated.role });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/calls ─────────────────────────────────────────────────────
// All call sessions across all workspaces, with lead + workspace info.
// Query: ?workspaceId=xxx&page=1&limit=50

router.get("/api/admin/calls", async (req: Request, res: Response) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page  as string) || 1);
    const limit  = Math.min(200, parseInt(req.query.limit as string) || 50);
    const offset = (page - 1) * limit;
    const filterWs = req.query.workspaceId as string | undefined;

    const enrollmentLeads = alias(leads, "enrollment_leads");
    const directLeads     = alias(leads, "direct_leads");

    let query = db
      .select({
        id:              sdrCallSessions.id,
        workspaceId:     sdrCallSessions.workspaceId,
        workspaceName:   workspaces.name,
        enrollmentId:    sdrCallSessions.enrollmentId,
        twilioCallSid:   sdrCallSessions.twilioCallSid,
        status:          sdrCallSessions.status,
        durationSeconds: sdrCallSessions.durationSeconds,
        outcome:         sdrCallSessions.outcome,
        aiSummary:       sdrCallSessions.aiSummary,
        transcript:      sdrCallSessions.transcript,
        recordingUrl:    sdrCallSessions.recordingUrl,
        startedAt:       sdrCallSessions.startedAt,
        endedAt:         sdrCallSessions.endedAt,
        leadFirstName:   sql<string | null>`COALESCE(${enrollmentLeads.firstName}, ${directLeads.firstName})`,
        leadLastName:    sql<string | null>`COALESCE(${enrollmentLeads.lastName},  ${directLeads.lastName})`,
        leadPhone:       sql<string | null>`COALESCE(${enrollmentLeads.phone},     ${directLeads.phone})`,
        leadEmail:       sql<string | null>`COALESCE(${enrollmentLeads.email},     ${directLeads.email})`,
      })
      .from(sdrCallSessions)
      .leftJoin(workspaces,       eq(sdrCallSessions.workspaceId, workspaces.id))
      .leftJoin(sdrEnrollments,   eq(sdrCallSessions.enrollmentId, sdrEnrollments.id))
      .leftJoin(enrollmentLeads,  eq(sdrEnrollments.leadId, enrollmentLeads.id))
      .leftJoin(directLeads,      eq(sdrCallSessions.leadId, directLeads.id))
      .$dynamic();

    if (filterWs) query = query.where(eq(sdrCallSessions.workspaceId, filterWs)) as typeof query;

    const sessions = await query.orderBy(desc(sdrCallSessions.startedAt)).limit(limit).offset(offset);

    // Total count
    let countQuery = db.select({ total: count() }).from(sdrCallSessions).$dynamic();
    if (filterWs) countQuery = countQuery.where(eq(sdrCallSessions.workspaceId, filterWs)) as typeof countQuery;
    const [{ total }] = await countQuery;

    res.json({
      data: sessions.map(s => ({
        ...s,
        leadName: s.leadFirstName ? `${s.leadFirstName} ${s.leadLastName || ""}`.trim() : null,
      })),
      total: Number(total),
      page,
      limit,
      pages: Math.ceil(Number(total) / limit),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/calls/:id ─────────────────────────────────────────────────
// Single call session with full transcript + summary (admin view, any workspace).

router.get("/api/admin/calls/:id", async (req: Request, res: Response) => {
  try {
    const enrollmentLeads = alias(leads, "enrollment_leads");
    const directLeads     = alias(leads, "direct_leads");

    const [session] = await db
      .select({
        id:              sdrCallSessions.id,
        workspaceId:     sdrCallSessions.workspaceId,
        workspaceName:   workspaces.name,
        enrollmentId:    sdrCallSessions.enrollmentId,
        twilioCallSid:   sdrCallSessions.twilioCallSid,
        twilioStreamSid: sdrCallSessions.twilioStreamSid,
        status:          sdrCallSessions.status,
        durationSeconds: sdrCallSessions.durationSeconds,
        outcome:         sdrCallSessions.outcome,
        aiSummary:       sdrCallSessions.aiSummary,
        transcript:      sdrCallSessions.transcript,
        recordingUrl:    sdrCallSessions.recordingUrl,
        startedAt:       sdrCallSessions.startedAt,
        endedAt:         sdrCallSessions.endedAt,
        leadFirstName:   sql<string | null>`COALESCE(${enrollmentLeads.firstName}, ${directLeads.firstName})`,
        leadLastName:    sql<string | null>`COALESCE(${enrollmentLeads.lastName},  ${directLeads.lastName})`,
        leadPhone:       sql<string | null>`COALESCE(${enrollmentLeads.phone},     ${directLeads.phone})`,
        leadEmail:       sql<string | null>`COALESCE(${enrollmentLeads.email},     ${directLeads.email})`,
      })
      .from(sdrCallSessions)
      .leftJoin(workspaces,       eq(sdrCallSessions.workspaceId, workspaces.id))
      .leftJoin(sdrEnrollments,   eq(sdrCallSessions.enrollmentId, sdrEnrollments.id))
      .leftJoin(enrollmentLeads,  eq(sdrEnrollments.leadId, enrollmentLeads.id))
      .leftJoin(directLeads,      eq(sdrCallSessions.leadId, directLeads.id))
      .where(eq(sdrCallSessions.id, req.params.id as string));

    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json({ ...session, leadName: session.leadFirstName ? `${session.leadFirstName} ${session.leadLastName || ""}`.trim() : null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/organizations ────────────────────────────────────────────
// List all organizations with user + workspace counts.

router.get("/api/admin/organizations", async (_req: Request, res: Response) => {
  try {
    const orgs = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        createdAt: organizations.createdAt,
        costPerAppointmentCents: organizations.costPerAppointmentCents,
        monthlyFeeEnabled: organizations.monthlyFeeEnabled,
        monthlyFeeOverrideCents: organizations.monthlyFeeOverrideCents,
        appointmentFeeEnabled: organizations.appointmentFeeEnabled,
      })
      .from(organizations)
      .orderBy(desc(organizations.createdAt));

    // Attach user + workspace counts
    const allUsers = await db.select({ organizationId: users.organizationId }).from(users);
    const allWorkspaces = await db.select({ organizationId: workspaces.organizationId, tier: workspaces.tier, isActive: workspaces.isActive }).from(workspaces);

    const result = orgs.map((org) => ({
      ...org,
      userCount: allUsers.filter((u) => u.organizationId === org.id).length,
      workspaceCount: allWorkspaces.filter((w) => w.organizationId === org.id).length,
      tier: allWorkspaces.find((w) => w.organizationId === org.id)?.tier ?? "—",
      isActive: allWorkspaces.find((w) => w.organizationId === org.id)?.isActive ?? false,
    }));

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Commercial pricing (global monthly + per-org appointment fees) ──────────

router.get("/api/admin/commercial-pricing", async (_req: Request, res: Response) => {
  try {
    const {
      getPlatformCommercialDefaults,
    } = await import("../lib/commercial-pricing-service.js");
    const defaults = await getPlatformCommercialDefaults();
    res.json(defaults);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/admin/pricing/clients", async (_req: Request, res: Response) => {
  try {
    const {
      getPlatformCommercialDefaults,
      listPricingClients,
    } = await import("../lib/commercial-pricing-service.js");
    const [platform, clients] = await Promise.all([
      getPlatformCommercialDefaults(),
      listPricingClients(),
    ]);
    res.json({ platform, clients });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/admin/commercial-pricing", async (req: Request, res: Response) => {
  try {
    const {
      updatePlatformCommercialDefaults,
    } = await import("../lib/commercial-pricing-service.js");
    const body = req.body || {};
    const defaults = await updatePlatformCommercialDefaults({
      monthlyFeeCents:
        body.monthlyFeeCents != null ? Number(body.monthlyFeeCents) : undefined,
      monthlyFeeEnabledByDefault:
        body.monthlyFeeEnabledByDefault != null
          ? !!body.monthlyFeeEnabledByDefault
          : undefined,
      defaultAppointmentFeeCents:
        body.defaultAppointmentFeeCents != null
          ? Number(body.defaultAppointmentFeeCents)
          : undefined,
    });
    res.json(defaults);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.patch("/api/admin/organizations/:id/commercial-pricing", async (req: Request, res: Response) => {
  try {
    const orgId = Number(req.params.id);
    if (!Number.isFinite(orgId) || orgId <= 0) {
      return res.status(400).json({ error: "Invalid organization id" });
    }
    const {
      updateOrgCommercialPricing,
    } = await import("../lib/commercial-pricing-service.js");
    const body = req.body || {};
    const pricing = await updateOrgCommercialPricing(orgId, {
      monthlyFeeEnabled:
        "monthlyFeeEnabled" in body ? body.monthlyFeeEnabled : undefined,
      monthlyFeeOverrideCents:
        "monthlyFeeOverrideCents" in body ? body.monthlyFeeOverrideCents : undefined,
      clearMonthlyOverride: !!body.clearMonthlyOverride,
      appointmentFeeEnabled:
        "appointmentFeeEnabled" in body ? body.appointmentFeeEnabled : undefined,
      costPerAppointmentCents:
        "costPerAppointmentCents" in body ? body.costPerAppointmentCents : undefined,
    });
    res.json(pricing);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/api/admin/organizations/:id/charges", async (req: Request, res: Response) => {
  try {
    const orgId = Number(req.params.id);
    if (!Number.isFinite(orgId) || orgId <= 0) {
      return res.status(400).json({ error: "Invalid organization id" });
    }
    const { listRecentAppointmentCharges } = await import("../lib/commercial-pricing-service.js");
    const charges = await listRecentAppointmentCharges(orgId, Number(req.query.limit) || 50);
    res.json({ charges });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/admin/payments", async (req: Request, res: Response) => {
  try {
    const {
      listPlatformCharges,
      summarizeCharges,
    } = await import("../lib/commercial-pricing-service.js");
    const periodRaw = (req.query.period as string) || "";
    const yearRaw = (req.query.year as string) || "";
    const startDate = (req.query.startDate as string) || "";
    const endDate = (req.query.endDate as string) || "";
    const period =
      !startDate && !endDate && periodRaw && periodRaw !== "all" ? periodRaw : undefined;
    const year =
      !startDate && !endDate && !period && yearRaw && yearRaw !== "all" ? yearRaw : undefined;
    const organizationId = req.query.organizationId
      ? Number(req.query.organizationId)
      : undefined;
    const status = (req.query.status as string) || undefined;
    const feeKind = (req.query.feeKind as string) || undefined;
    const q = (req.query.q as string) || undefined;
    const charges = await listPlatformCharges({
      period,
      year,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      organizationId: Number.isFinite(organizationId as number) ? organizationId : undefined,
      status: status && status !== "all" ? status : undefined,
      feeKind: feeKind && feeKind !== "all" ? feeKind : undefined,
      q,
      limit: Number(req.query.limit) || 500,
    });
    res.json({
      period: period || null,
      year: year ? Number(year) : null,
      startDate: startDate || null,
      endDate: endDate || null,
      q: q || null,
      charges,
      summary: summarizeCharges(charges),
      filters: {
        period: period || "all",
        year: year || "all",
        startDate: startDate || "",
        endDate: endDate || "",
        status: status || "all",
        feeKind: feeKind || "all",
        q: q || "",
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/admin/payments/bill/:orgId", async (req: Request, res: Response) => {
  try {
    const orgId = Number(req.params.orgId);
    if (!Number.isFinite(orgId) || orgId <= 0) {
      return res.status(400).json({ error: "Invalid organization id" });
    }
    const {
      getOrgMonthlyBill,
      billingPeriodKey,
    } = await import("../lib/commercial-pricing-service.js");
    const period = (req.query.period as string) || billingPeriodKey();
    const bill = await getOrgMonthlyBill(orgId, period);
    res.json(bill);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/api/admin/payments/receipt/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { getChargeReceipt } = await import("../lib/commercial-pricing-service.js");
    const receipt = await getChargeReceipt(id);
    if (!receipt) return res.status(404).json({ error: "Receipt not found" });
    res.json(receipt);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/admin/payments/:id/status", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const status = String(req.body?.status || "");
    if (!["pending", "invoiced", "paid", "waived"].includes(status)) {
      return res.status(400).json({ error: "status must be pending, invoiced, paid, or waived" });
    }
    const { updateChargeStatus } = await import("../lib/commercial-pricing-service.js");
    const row = await updateChargeStatus(id, status as any);
    if (!row) return res.status(404).json({ error: "Charge not found" });
    res.json(row);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
