import { Router, Request, Response } from "express";
import { sendEmail, isResendConfigured } from "../lib/resend.js";
import { storage } from "../lib/storage.js";
import { requireAuth } from "./auth.js";
import { db } from "../lib/db.js";
import { workspaces, sdrCallSessions } from "../lib/schema.js";
import { eq } from "drizzle-orm";
import { sendOutboundSms, workspacePhoneConnected, workspaceFromNumber, placeOutboundCall, resolveVoiceProvider } from "../lib/telephony.js";
import { liveCallRegistry } from "../lib/calling/live-call-registry.js";

const router = Router();

// ─── helpers ─────────────────────────────────────────────────────────────────

async function getWorkspaceForOrg(organizationId: string) {
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.organizationId, organizationId));
  return ws ?? null;
}

// ─── POST /api/leads/:id/sms ──────────────────────────────────────────────────

router.post("/api/leads/:id/sms", requireAuth, async (req: Request, res: Response) => {
  try {
    const lead = await storage.getLead(parseInt(req.params.id), req.organizationId);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (!lead.phone) return res.status(400).json({ error: "Lead has no phone number" });

    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message content required" });

    let deliveryResult: { success: boolean; sid?: string; error?: string } = {
      success: false,
      error: "Phone/SMS not connected — add Twilio or Telnyx in SDR Setup",
    };

    const ws = await getWorkspaceForOrg(req.organizationId);
    if (ws && workspacePhoneConnected(ws)) {
      try {
        const sent = await sendOutboundSms(ws, { to: lead.phone, body: message });
        deliveryResult = { success: true, sid: sent.sid };
      } catch (err: any) {
        deliveryResult = { success: false, error: err.message };
      }
    }

    const msg = await storage.createLeadMessage({
      leadId: parseInt(req.params.id),
      channel: "sms",
      content: message,
      status: deliveryResult.success ? "sent" : (workspacePhoneConnected(ws || {}) ? "failed" : "pending"),
      direction: "outbound",
      aiGenerated: req.body.aiGenerated || false,
    });

    await storage.logActivity({
      entityType: "lead",
      entityId: parseInt(req.params.id),
      action: "sms_sent",
      details: `SMS to ${lead.phone}: ${message.substring(0, 50)}...`,
      organizationId: req.organizationId,
    });

    res.status(201).json({
      message: msg,
      delivery: deliveryResult,
      twilioConfigured: workspacePhoneConnected(ws || {}),
      phoneConfigured: workspacePhoneConnected(ws || {}),
      fromNumber: workspaceFromNumber(ws || {}),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /api/leads/:id/email ────────────────────────────────────────────────

router.post("/api/leads/:id/email", requireAuth, async (req: Request, res: Response) => {
  try {
    const lead = await storage.getLead(parseInt(req.params.id), req.organizationId);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (!lead.email) return res.status(400).json({ error: "Lead has no email" });

    const { subject, body } = req.body;
    if (!subject || !body) return res.status(400).json({ error: "Subject and body required" });

    let deliveryResult: { success: boolean; error?: string } = {
      success: false,
      error: "Resend not configured",
    };
    if (isResendConfigured()) {
      deliveryResult = await sendEmail(lead.email, subject, body);
    }

    const msg = await storage.createLeadMessage({
      leadId: parseInt(req.params.id),
      channel: "email",
      content: `Subject: ${subject}\n\n${body}`,
      status: deliveryResult.success ? "sent" : (isResendConfigured() ? "failed" : "pending"),
      direction: "outbound",
      aiGenerated: req.body.aiGenerated || false,
    });

    await storage.logActivity({
      entityType: "lead",
      entityId: parseInt(req.params.id),
      action: "email_sent",
      details: `Email to ${lead.email}: ${subject}`,
      organizationId: req.organizationId,
    });

    res.status(201).json({
      message: msg,
      delivery: deliveryResult,
      resendConfigured: isResendConfigured(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /api/leads/:id/call ─────────────────────────────────────────────────
// Initiates a manual AI call using the workspace's BYOT Twilio or Telnyx stack.

router.post("/api/leads/:id/call", requireAuth, async (req: Request, res: Response) => {
  try {
    const lead = await storage.getLead(parseInt(req.params.id), req.organizationId);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (!lead.phone) return res.status(400).json({ error: "Lead has no phone number" });

    const ws = await getWorkspaceForOrg(req.organizationId);
    if (!ws || !workspacePhoneConnected(ws)) {
      return res.status(400).json({ error: "Phone not connected — add Twilio or Telnyx in SDR Setup" });
    }

    const baseUrl = process.env.BASE_URL;
    if (!baseUrl) return res.status(500).json({ error: "BASE_URL env var not set" });

    const [session] = await db
      .insert(sdrCallSessions)
      .values({
        workspaceId: ws.id,
        leadId:      lead.id,
        status:      "initiated",
        startedAt:   new Date(),
      })
      .returning();

    const placed = await placeOutboundCall(ws, {
      to: lead.phone,
      connectUrl: `${baseUrl}/api/call/connect/${session.id}`,
      statusCallback: `${baseUrl}/api/call/status/${session.id}`,
      recordingStatusCallback: `${baseUrl}/api/call/recording/${session.id}`,
      record: true,
    });

    await db
      .update(sdrCallSessions)
      .set({ twilioCallSid: placed.sid })
      .where(eq(sdrCallSessions.id, session.id));

    liveCallRegistry.start(session.id, ws.id, []);
    liveCallRegistry.setStatus(session.id, "initiated");

    await storage.logActivity({
      entityType: "lead",
      entityId: parseInt(req.params.id),
      action: "call_initiated",
      details: `Manual AI call (${placed.provider}) to ${lead.phone} (session ${session.id})`,
      organizationId: req.organizationId,
    });

    res.json({
      call: { success: true, sid: placed.sid, sessionId: session.id, provider: placed.provider },
      twilioConfigured: true,
      phoneConfigured: true,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /api/integrations/status ────────────────────────────────────────────

router.get("/api/integrations/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const ws = await getWorkspaceForOrg(req.organizationId);
    res.json({
      twilio: !!(ws?.twilioSubAccountSid && ws?.twilioPhoneNumber),
      telnyx: !!(ws?.telnyxApiKey && ws?.telnyxPhoneNumber),
      phone: workspacePhoneConnected(ws || {}),
      activeProvider: resolveVoiceProvider(ws || {}),
      resend: isResendConfigured(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
