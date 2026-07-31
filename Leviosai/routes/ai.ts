import { Router, Request, Response } from "express";
import { scoreLead, generateMessage, handleObjection, isAIConfigured } from "../lib/ai.js";
import { storage } from "../lib/storage.js";
import { requireAuth } from "./auth.js";

const router = Router();

// Score a lead with AI
router.post("/api/leads/:id/score", requireAuth, async (req: Request, res: Response) => {
  try {
    const lead = await storage.getLead(parseInt(req.params.id), req.organizationId);
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    const result = await scoreLead({
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email,
      phone: lead.phone,
      source: lead.source,
      status: lead.status,
      lastContactedAt: lead.lastContactedAt,
      notes: req.body.notes,
    });

    // Update lead with AI score (org-scoped)
    await storage.updateLead(parseInt(req.params.id), {
      aiScore: result.score,
      aiTemperature: result.temperature,
      aiObjection: result.objection,
    }, req.organizationId);

    await storage.logActivity({
      entityType: "lead",
      entityId: parseInt(req.params.id),
      action: "ai_scored",
      details: `AI Score: ${result.score}, Temp: ${result.temperature}. ${result.reasoning}`,
      organizationId: req.organizationId,
    });

    res.json({ ...result, aiConfigured: isAIConfigured() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Generate AI message for a lead
router.post("/api/leads/:id/generate-message", requireAuth, async (req: Request, res: Response) => {
  try {
    const lead = await storage.getLead(parseInt(req.params.id), req.organizationId);
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    const { channel, context } = req.body;
    if (!channel || !["sms", "email"].includes(channel)) {
      return res.status(400).json({ error: "Channel must be 'sms' or 'email'" });
    }

    const result = await generateMessage(
      { firstName: lead.firstName, lastName: lead.lastName, source: lead.source, status: lead.status },
      channel,
      context
    );

    res.json({ ...result, aiConfigured: isAIConfigured() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Handle objection with AI
router.post("/api/ai/objection", requireAuth, async (req: Request, res: Response) => {
  try {
    const { objection, leadContext } = req.body;
    if (!objection) return res.status(400).json({ error: "Objection text required" });

    const result = await handleObjection(objection, leadContext || "");
    res.json({ ...result, aiConfigured: isAIConfigured() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Score all unscored leads (org-scoped)
router.post("/api/leads/score-all", requireAuth, async (req: Request, res: Response) => {
  try {
    const leads = await storage.getLeads({ organizationId: req.organizationId });
    const unscored = leads.filter((l: any) => !l.aiScore || l.aiScore === 0);
    const results = [];

    for (const lead of unscored.slice(0, 10)) {
      const result = await scoreLead({
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.email,
        phone: lead.phone,
        source: lead.source,
        status: lead.status,
        lastContactedAt: lead.lastContactedAt,
      });

      await storage.updateLead(lead.id, {
        aiScore: result.score,
        aiTemperature: result.temperature,
        aiObjection: result.objection,
      }, req.organizationId);

      results.push({ leadId: lead.id, name: `${lead.firstName} ${lead.lastName}`, ...result });
    }

    res.json({ scored: results.length, results, aiConfigured: isAIConfigured() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// AI status (no auth needed — informational)
router.get("/api/ai/status", async (_req: Request, res: Response) => {
  res.json({ configured: isAIConfigured() });
});

export default router;
