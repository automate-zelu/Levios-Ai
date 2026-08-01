import { Router, Request, Response } from "express";
import { storage } from "../lib/storage.js";
import { requireAuth } from "./auth.js";
import { Reactor } from "../reactor/reactor.js";
import { db } from "../lib/db.js";
import { organizations } from "../lib/schema.js";
import { eq } from "drizzle-orm";

const router = Router();

// ─── DASHBOARD ──────────────────────────────────────────────────────────────

router.get("/api/dashboard", requireAuth, async (req: Request, res: Response) => {
  try {
    const stats = await storage.getDashboardStats(req.organizationId);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── ORGANIZATIONS ──────────────────────────────────────────────────────────

router.get("/api/organizations", requireAuth, async (req, res) => {
  try {
    // Users can only see their own org
    if (req.organizationId) {
      const org = await storage.getOrganization(req.organizationId);
      res.json(org ? [org] : []);
    } else {
      res.json([]);
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/organizations", requireAuth, async (req, res) => {
  try {
    const org = await storage.createOrganization(req.body);
    res.status(201).json(org);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ─── LEADS ──────────────────────────────────────────────────────────────────

router.get("/api/leads", requireAuth, async (req, res) => {
  try {
    const { status, temperature, search } = req.query;
    const leads = await storage.getLeads({
      status: status as string,
      temperature: temperature as string,
      search: search as string,
      organizationId: req.organizationId,
    });
    res.json(leads);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/leads/pipeline/stats", requireAuth, async (req, res) => {
  try {
    const stats = await storage.getPipelineStats(req.organizationId);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/leads/:id", requireAuth, async (req, res) => {
  try {
    const lead = await storage.getLead(parseInt(req.params.id), req.organizationId);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    res.json(lead);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/leads", requireAuth, async (req, res) => {
  try {
    const lead = await storage.createLead({
      ...req.body,
      organizationId: req.organizationId,
    });
    await storage.logActivity({
      entityType: "lead",
      entityId: lead.id,
      action: "created",
      details: `Lead ${lead.firstName} ${lead.lastName} created`,
      organizationId: req.organizationId,
    });

    // Emit to Reactor if org has it enabled
    if (req.organizationId) {
      const [org] = await db.select({ reactorEnabled: organizations.reactorEnabled }).from(organizations).where(eq(organizations.id, req.organizationId));
      if (org?.reactorEnabled) {
        const reactor = Reactor.getInstance();
        reactor.emit({
          type: "lead.created",
          organizationId: req.organizationId,
          payload: { leadId: lead.id },
          metadata: { leadId: lead.id, priority: 3, agentSource: "api" },
        });
      }
    }

    res.status(201).json(lead);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.patch("/api/leads/:id", requireAuth, async (req, res) => {
  try {
    const lead = await storage.updateLead(parseInt(req.params.id), req.body, req.organizationId);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    await storage.logActivity({
      entityType: "lead",
      entityId: lead.id,
      action: "updated",
      details: `Lead updated: ${JSON.stringify(req.body)}`,
      organizationId: req.organizationId,
    });
    res.json(lead);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.delete("/api/leads/:id", requireAuth, async (req, res) => {
  try {
    await storage.deleteLead(parseInt(req.params.id), req.organizationId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── LEAD MESSAGES ──────────────────────────────────────────────────────────

router.get("/api/leads/:id/messages", requireAuth, async (req, res) => {
  try {
    // Verify lead belongs to org
    const lead = await storage.getLead(parseInt(req.params.id), req.organizationId);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    const messages = await storage.getLeadMessages(parseInt(req.params.id));
    res.json(messages);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/leads/:id/messages", requireAuth, async (req, res) => {
  try {
    // Verify lead belongs to org
    const lead = await storage.getLead(parseInt(req.params.id), req.organizationId);
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    const msg = await storage.createLeadMessage({
      ...req.body,
      leadId: parseInt(req.params.id),
    });
    await storage.logActivity({
      entityType: "lead",
      entityId: parseInt(req.params.id),
      action: "message_sent",
      details: `${req.body.channel} message ${req.body.direction || "outbound"}`,
      organizationId: req.organizationId,
    });
    res.status(201).json(msg);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/api/messages/recent", requireAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const messages = await storage.getRecentMessages(limit, req.organizationId);
    res.json(messages);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Inbox threads for SDR SMS / Email pages
router.get("/api/messages/threads", requireAuth, async (req, res) => {
  try {
    const channel = String(req.query.channel || "").toLowerCase();
    if (channel !== "sms" && channel !== "email") {
      return res.status(400).json({ error: "channel must be sms or email" });
    }
    if (!req.organizationId) {
      return res.status(400).json({ error: "No organization" });
    }
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
    const threads = await storage.getMessageThreads(req.organizationId, channel, limit);
    res.json({ channel, threads });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── APPOINTMENTS ───────────────────────────────────────────────────────────

router.get("/api/appointments", requireAuth, async (req, res) => {
  try {
    const { status, leadId } = req.query;
    const appts = await storage.getAppointments({
      status: status as string,
      leadId: leadId ? parseInt(leadId as string) : undefined,
      organizationId: req.organizationId,
    });
    res.json(appts);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/appointments", requireAuth, async (req, res) => {
  try {
    const { bookAppointmentWithCalendar } = await import("../lib/calendar/service.js");
    const { parseScheduledAt } = await import("../lib/calendar/booking-helpers.js");
    const { ensureAppointmentCalendarColumns } = await import("../lib/calendar/schema-ensure.js");

    await ensureAppointmentCalendarColumns();

    const leadId = Number(req.body.leadId);
    const scheduledAt = parseScheduledAt(req.body.scheduledAt);
    if (!leadId || !scheduledAt) {
      return res.status(400).json({ error: "leadId and scheduledAt are required" });
    }
    if (!req.organizationId) {
      return res.status(400).json({ error: "No organization" });
    }

    const result = await bookAppointmentWithCalendar({
      organizationId: req.organizationId,
      leadId,
      title: req.body.title || "Consultation",
      scheduledAt,
      description: req.body.description,
      durationMinutes: req.body.durationMinutes,
      attendeeEmail: req.body.attendeeEmail,
      attendeeName: req.body.attendeeName,
      timezone: req.body.timezone,
    });

    const appt = await storage.getAppointments({
      leadId,
      organizationId: req.organizationId,
    });
    const created = appt.find((a) => a.id === result.appointmentId) || {
      id: result.appointmentId,
      leadId,
      title: req.body.title || "Consultation",
      scheduledAt,
      status: "scheduled",
      calendarEventId: result.calendarEventId,
      calendarProvider: result.calendarProvider,
    };

    await storage.logActivity({
      entityType: "appointment",
      entityId: result.appointmentId,
      action: "created",
      details: `Appointment scheduled for ${scheduledAt.toISOString()}${
        result.synced ? ` (synced to ${result.calendarProvider})` : ""
      }`,
      organizationId: req.organizationId,
    });
    res.status(201).json({ ...created, calendarSynced: result.synced, syncError: result.syncError });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.patch("/api/appointments/:id", requireAuth, async (req, res) => {
  try {
    const appt = await storage.updateAppointment(
      parseInt(req.params.id),
      req.body
    );
    if (!appt) return res.status(404).json({ error: "Appointment not found" });
    res.json(appt);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.delete("/api/appointments/:id", requireAuth, async (req, res) => {
  try {
    await storage.deleteAppointment(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── CAMPAIGNS ──────────────────────────────────────────────────────────────

router.get("/api/campaigns", requireAuth, async (req, res) => {
  try {
    const campaigns = await storage.getCampaigns(req.organizationId);
    res.json(campaigns);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/campaigns", requireAuth, async (req, res) => {
  try {
    const campaign = await storage.createCampaign({
      ...req.body,
      organizationId: req.organizationId,
    });
    res.status(201).json(campaign);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.patch("/api/campaigns/:id", requireAuth, async (req, res) => {
  try {
    const campaign = await storage.updateCampaign(
      parseInt(req.params.id),
      req.body,
      req.organizationId
    );
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    res.json(campaign);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ─── PROPOSALS ──────────────────────────────────────────────────────────────

router.get("/api/proposals", requireAuth, async (req, res) => {
  try {
    const leadId = req.query.leadId
      ? parseInt(req.query.leadId as string)
      : undefined;
    const proposals = await storage.getProposals(leadId, req.organizationId);
    res.json(proposals);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/proposals", requireAuth, async (req, res) => {
  try {
    const proposal = await storage.createProposal(req.body);
    await storage.logActivity({
      entityType: "proposal",
      entityId: proposal.id,
      action: "created",
      details: `Proposal "${proposal.title}" for $${proposal.amount}`,
      organizationId: req.organizationId,
    });
    res.status(201).json(proposal);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.patch("/api/proposals/:id", requireAuth, async (req, res) => {
  try {
    const proposal = await storage.updateProposal(
      parseInt(req.params.id),
      req.body
    );
    if (!proposal) return res.status(404).json({ error: "Proposal not found" });
    res.json(proposal);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.delete("/api/proposals/:id", requireAuth, async (req, res) => {
  try {
    await storage.deleteProposal(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── ACTIVITY LOGS ──────────────────────────────────────────────────────────

router.get("/api/activity", requireAuth, async (req, res) => {
  try {
    const { entityType, entityId, limit } = req.query;
    const logs = await storage.getActivityLogs(
      entityType as string,
      entityId ? parseInt(entityId as string) : undefined,
      limit ? parseInt(limit as string) : 50,
      req.organizationId
    );
    res.json(logs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── HEALTH CHECK (no auth required) ────────────────────────────────────────
// Returns per-service status for Railway health checks + production monitoring.
// Response shape:
//   { status: "ok"|"degraded"|"error", services: { db, redis, twilio, ai, email } }
// HTTP 200 = at least DB is up; 503 = DB down (Railway restarts the pod).

router.get("/api/health", async (_req, res) => {
  const services: Record<string, "ok" | "error" | "unconfigured"> = {};
  let dbOk = false;

  // ── Database ──
  try {
    await storage.getDashboardStats();
    services.database = "ok";
    dbOk = true;
  } catch {
    services.database = "error";
  }

  // ── Redis / BullMQ ──
  try {
    if (!process.env.REDIS_URL) {
      services.redis = "unconfigured";
    } else {
      const { redis: redisClient, isRedisReady } = await import("../lib/redis.js");
      services.redis = (redisClient && isRedisReady()) ? "ok" : "error";
    }
  } catch {
    services.redis = "error";
  }

  // ── Twilio ──
  services.twilio = (
    process.env.TWILIO_MASTER_SID || process.env.TWILIO_ACCOUNT_SID
  ) ? "ok" : "unconfigured";

  // ── AI services ──
  services.deepgram   = process.env.DEEPGRAM_API_KEY   ? "ok" : "unconfigured";
  services.openai     = process.env.OPENAI_API_KEY      ? "ok" : "unconfigured";
  services.elevenlabs = process.env.ELEVENLABS_API_KEY  ? "ok" : "unconfigured";
  services.anthropic  = process.env.ANTHROPIC_API_KEY   ? "ok" : "unconfigured";

  // ── Email ──
  services.resend = process.env.RESEND_API_KEY ? "ok" : "unconfigured";

  // ── Stripe ──
  services.stripe = process.env.STRIPE_SECRET_KEY ? "ok" : "unconfigured";

  const anyError = Object.values(services).includes("error");
  const overallStatus = !dbOk ? "error" : anyError ? "degraded" : "ok";

  res.status(dbOk ? 200 : 503).json({
    status: overallStatus,
    services,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? "unknown",
  });
});

export default router;
