import { Router, Request, Response } from "express";
import { sendEmail, isResendConfigured } from "../lib/resend.js";
import { storage } from "../lib/storage.js";
import { requireAuth } from "./auth.js";
import { db } from "../lib/db.js";
import { workspaces, sdrCallSessions } from "../lib/schema.js";
import { eq } from "drizzle-orm";
import { getClientForWorkspace } from "../lib/twilio-subaccount.js";
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
      error: "Twilio not connected — add credentials on the Twilio page",
    };

    // Use workspace BYOT Twilio credentials
    const ws = await getWorkspaceForOrg(req.organizationId);
    if (ws?.twilioSubAccountSid && ws?.twilioPhoneNumber) {
      try {
        const { client } = getClientForWorkspace(ws);
        const msg = await client.messages.create({
          body: message,
          from: ws.twilioPhoneNumber,
          to: lead.phone,
        });
        deliveryResult = { success: true, sid: msg.sid };
      } catch (err: any) {
        deliveryResult = { success: false, error: err.message };
      }
    }

    const msg = await storage.createLeadMessage({
      leadId: parseInt(req.params.id),
      channel: "sms",
      content: message,
      status: deliveryResult.success ? "sent" : (ws?.twilioSubAccountSid ? "failed" : "pending"),
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
      twilioConfigured: !!(ws?.twilioSubAccountSid && ws?.twilioPhoneNumber),
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
// Initiates a manual AI call using the workspace's BYOT Twilio credentials.
// Creates a call session so the full AI pipeline (Deepgram+GPT-4o+ElevenLabs)
// handles the conversation using the workspace's SDR config.

router.post("/api/leads/:id/call", requireAuth, async (req: Request, res: Response) => {
  try {
    const lead = await storage.getLead(parseInt(req.params.id), req.organizationId);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (!lead.phone) return res.status(400).json({ error: "Lead has no phone number" });

    const ws = await getWorkspaceForOrg(req.organizationId);
    if (!ws?.twilioSubAccountSid || !ws?.twilioPhoneNumber) {
      return res.status(400).json({ error: "Twilio not connected — add credentials on the Twilio page" });
    }

    const baseUrl = process.env.BASE_URL;
    if (!baseUrl) return res.status(500).json({ error: "BASE_URL env var not set" });

    // Create a call session — no enrollmentId (manual call, not SDR sequence)
    const [session] = await db
      .insert(sdrCallSessions)
      .values({
        workspaceId: ws.id,
        leadId:      lead.id,
        status:      "initiated",
        startedAt:   new Date(),
      })
      .returning();

    // Place call — TwiML URL includes session ID so the AI pipeline handles it
    const { client, fromNumber } = getClientForWorkspace(ws);
    const call = await client.calls.create({
      to:   lead.phone,
      from: fromNumber!,
      url:  `${baseUrl}/api/call/connect/${session.id}`,
      statusCallback:       `${baseUrl}/api/call/status/${session.id}`,
      statusCallbackMethod: "POST",
      statusCallbackEvent:  ["completed", "no-answer", "busy", "failed"],
    });

    // Store Twilio call SID
    await db
      .update(sdrCallSessions)
      .set({ twilioCallSid: call.sid })
      .where(eq(sdrCallSessions.id, session.id));

    // Appear on Live Calls page while ringing (before media stream opens)
    liveCallRegistry.start(session.id, ws.id, []);
    liveCallRegistry.setStatus(session.id, "initiated");

    await storage.logActivity({
      entityType: "lead",
      entityId: parseInt(req.params.id),
      action: "call_initiated",
      details: `Manual AI call to ${lead.phone} (session ${session.id})`,
      organizationId: req.organizationId,
    });

    res.json({
      call: { success: true, sid: call.sid, sessionId: session.id },
      twilioConfigured: true,
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
      resend: isResendConfigured(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
