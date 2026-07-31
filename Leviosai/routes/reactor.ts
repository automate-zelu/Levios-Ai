// ─── REACTOR API ROUTES ─────────────────────────────────────────────────────
// Admin/debug endpoints for the Reactor orchestrator.

import { Router, Request, Response } from "express";
import { requireAuth } from "./auth.js";
import { Reactor } from "../reactor/reactor.js";

const router = Router();

// Get Reactor status
router.get("/api/reactor/status", requireAuth, async (_req: Request, res: Response) => {
  try {
    const reactor = Reactor.getInstance();
    res.json(reactor.getStatus());
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Manually emit an event into the Reactor
router.post("/api/reactor/emit", requireAuth, async (req: Request, res: Response) => {
  try {
    const { type, payload, leadId, priority } = req.body;
    if (!type) return res.status(400).json({ error: "Event type required" });

    const reactor = Reactor.getInstance();
    const eventId = reactor.emit({
      type,
      organizationId: req.organizationId!,
      payload: payload || {},
      metadata: {
        leadId,
        priority: priority || 3,
        agentSource: "manual",
      },
    });

    res.json({ eventId, queued: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Trigger processing for a specific lead
router.post("/api/reactor/leads/:id/process", requireAuth, async (req: Request, res: Response) => {
  try {
    const leadId = parseInt(req.params.id);
    const reactor = Reactor.getInstance();

    const eventId = reactor.emit({
      type: "routing.evaluate",
      organizationId: req.organizationId!,
      payload: { leadId },
      metadata: { leadId, priority: 3, agentSource: "manual" },
    });

    res.json({ eventId, leadId, queued: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Import leads via Reactor (CSV data as JSON array)
router.post("/api/reactor/import", requireAuth, async (req: Request, res: Response) => {
  try {
    const { leads } = req.body;
    if (!leads || !Array.isArray(leads)) {
      return res.status(400).json({ error: "leads array required" });
    }
    if (leads.length > 100_000) {
      return res.status(400).json({ error: "Max 100,000 leads per import" });
    }

    const reactor = Reactor.getInstance();
    const eventId = reactor.emit({
      type: "data.import",
      organizationId: req.organizationId!,
      payload: { leads, organizationId: req.organizationId },
      metadata: { priority: 4, agentSource: "import" },
    });

    res.json({ eventId, count: leads.length, queued: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get budget status for current org
router.get("/api/reactor/budget", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.organizationId) return res.status(400).json({ error: "No organization" });

    // Import dynamically to avoid circular deps
    const { db } = await import("../lib/db.js");
    const { budgetLedger, organizations } = await import("../lib/schema.js");
    const { eq, and, sql } = await import("drizzle-orm");

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, req.organizationId));

    const today = new Date().toISOString().split("T")[0];
    const monthPrefix = today.substring(0, 7);

    const [dailySpend] = await db
      .select({ total: sql<number>`coalesce(sum(cost_cents), 0)::int` })
      .from(budgetLedger)
      .where(and(eq(budgetLedger.organizationId, req.organizationId), eq(budgetLedger.dailyDate, today)));

    const [monthlySpend] = await db
      .select({ total: sql<number>`coalesce(sum(cost_cents), 0)::int` })
      .from(budgetLedger)
      .where(and(
        eq(budgetLedger.organizationId, req.organizationId),
        sql`${budgetLedger.dailyDate} LIKE ${monthPrefix + "%"}`
      ));

    res.json({
      monthlyBudgetCents: org?.monthlyBudgetCents || null,
      dailyBudgetCents: org?.dailyBudgetCents || null,
      monthlySpentCents: monthlySpend?.total || 0,
      dailySpentCents: dailySpend?.total || 0,
      monthlyRemainingCents: org?.monthlyBudgetCents
        ? (org.monthlyBudgetCents - (monthlySpend?.total || 0))
        : null,
      dailyRemainingCents: org?.dailyBudgetCents
        ? (org.dailyBudgetCents - (dailySpend?.total || 0))
        : null,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
