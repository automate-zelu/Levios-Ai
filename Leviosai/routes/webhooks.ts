import { Router, Request, Response } from "express";
import { storage } from "../lib/storage.js";
import { Reactor } from "../reactor/reactor.js";
import { db } from "../lib/db.js";
import { organizations, sdrEnrollments, leads } from "../lib/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { stateMachine } from "../lib/sdr-state-machine.js";
import { cancelJob } from "../lib/sdr-queue.js";
import { validateTwilioSms, validateTwilioGeneric } from "../middleware/twilioSignature.js";

const router = Router();

// Helper: check if org has Reactor enabled
async function isReactorEnabled(orgId: number | null | undefined): Promise<boolean> {
  if (!orgId) return false;
  const [org] = await db.select({ reactorEnabled: organizations.reactorEnabled }).from(organizations).where(eq(organizations.id, orgId));
  return org?.reactorEnabled === true;
}

// Twilio inbound SMS webhook
router.post("/api/webhooks/twilio/sms", validateTwilioSms, async (req: Request, res: Response) => {
  try {
    const { From, Body, MessageSid } = req.body;

    if (!From || !Body) {
      return res.status(400).send("<Response><Message>Invalid request</Message></Response>");
    }

    console.log(`📩 Inbound SMS from ${From}: ${Body.substring(0, 50)}...`);

    const lead = await storage.getLeadByPhone(From);

    if (lead) {
      // Always store the CRM message
      await storage.createLeadMessage({
        leadId: lead.id,
        channel: "sms",
        content: Body,
        status: "delivered",
        direction: "inbound",
        aiGenerated: false,
      });

      // ── SDR sequence reply gate ──────────────────────────────────────────────
      // If this lead has an active enrollment in sms_sent state, this reply
      // stops the sequence: cancel the SMS_TIMEOUT job and mark sms_replied.
      const [smsEnrollment] = await db
        .select()
        .from(sdrEnrollments)
        .where(and(
          eq(sdrEnrollments.leadId, lead.id),
          eq(sdrEnrollments.status, "sms_sent"),
        ))
        .orderBy(desc(sdrEnrollments.updatedAt))
        .limit(1);

      if (smsEnrollment) {
        if (smsEnrollment.bullmqJobId) {
          await cancelJob(smsEnrollment.bullmqJobId);
        }
        await stateMachine.transition(smsEnrollment.id, "sms_replied", {
          replyText: Body.substring(0, 500),
          from: From,
        });
        console.log(`✅ SDR: SMS reply from ${From} — enrollment ${smsEnrollment.id} → sms_replied`);
      }
      // ────────────────────────────────────────────────────────────────────────

      await storage.logActivity({
        entityType: "lead",
        entityId: lead.id,
        action: "sms_received",
        details: `Inbound SMS from ${From}: ${Body.substring(0, 100)}`,
        organizationId: lead.organizationId,
      });

      // Route through Reactor for AI processing (sentiment, etc.)
      if (await isReactorEnabled(lead.organizationId)) {
        const reactor = Reactor.getInstance();
        reactor.emit({
          type: "webhook.twilio.sms",
          organizationId: lead.organizationId!,
          payload: { from: From, body: Body, messageSid: MessageSid, leadId: lead.id },
          metadata: { leadId: lead.id, priority: 2, agentSource: "twilio-webhook" },
        });
      }
    } else {
      console.log(`⚠️  Inbound SMS from unknown number: ${From}`);
    }

    res.type("text/xml").send("<Response></Response>");
  } catch (error: any) {
    console.error("Twilio SMS webhook error:", error.message);
    res.type("text/xml").send("<Response></Response>");
  }
});

// Twilio call status callback
router.post("/api/webhooks/twilio/call-status", validateTwilioGeneric, async (req: Request, res: Response) => {
  try {
    const { CallSid, CallStatus, To, From, CallDuration } = req.body;

    console.log(`📞 Call status update: ${CallSid} → ${CallStatus} (${From} → ${To})`);

    const lead = await storage.getLeadByPhone(To);

    if (lead && await isReactorEnabled(lead.organizationId)) {
      const reactor = Reactor.getInstance();
      reactor.emit({
        type: "webhook.twilio.call_status",
        organizationId: lead.organizationId!,
        payload: { callSid: CallSid, callStatus: CallStatus, to: To, from: From, duration: CallDuration },
        metadata: { leadId: lead.id, priority: 4, agentSource: "twilio-webhook" },
      });
    } else if (lead) {
      await storage.logActivity({
        entityType: "lead",
        entityId: lead.id,
        action: "call_status",
        details: `Call ${CallSid}: ${CallStatus}${CallDuration ? ` (${CallDuration}s)` : ""}`,
        organizationId: lead.organizationId,
      });
    }

    res.sendStatus(200);
  } catch (error: any) {
    console.error("Twilio call status webhook error:", error.message);
    res.sendStatus(200);
  }
});

// Twilio voice webhook
router.post("/api/webhooks/twilio/voice", async (req: Request, res: Response) => {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Hello, this is Reviiv calling on behalf of your sales team. Please hold while we connect you.</Say>
  <Dial>${req.body.To || ""}</Dial>
</Response>`;

  res.type("text/xml").send(twiml);
});

// ─── SendGrid Inbound Parse — Email Reply Webhook ────────────────────────────
// SendGrid posts multipart/form-data when a lead replies to an SDR email.
// We match the reply to an active enrollment by the lead's email address,
// cancel the EMAIL_TIMEOUT BullMQ job, and transition the enrollment to email_replied.
//
// Setup in SendGrid dashboard:
//   Settings → Inbound Parse → Add Host & URL
//   MX Record:  mx.sendgrid.net  (add to DNS)
//   URL:        {BASE_URL}/api/webhooks/email/reply
//
// SendGrid posts: from, to, subject, text, html, envelope (JSON string)

router.post("/api/webhooks/email/reply", async (req: Request, res: Response) => {
  try {
    // SendGrid sends multipart — express.urlencoded or express-formidable needed.
    // With express.urlencoded({ extended: true }) already mounted in server.ts, form
    // fields are available on req.body when Content-Type is application/x-www-form-urlencoded.
    // For multipart, SendGrid also POSTs as x-www-form-urlencoded in basic parse mode.
    const from    = req.body.from    as string | undefined;
    const subject = req.body.subject as string | undefined;
    const text    = req.body.text    as string | undefined;

    if (!from) {
      return res.sendStatus(200); // Always 200 to SendGrid — don't retry
    }

    // Extract email address from "Name <email@example.com>" format
    const emailMatch = from.match(/<([^>]+)>/) ?? from.match(/\S+@\S+/);
    const replyEmail = emailMatch ? (emailMatch[1] ?? emailMatch[0]).toLowerCase().trim() : null;

    if (!replyEmail) {
      console.log("Email reply webhook: could not parse sender address from:", from);
      return res.sendStatus(200);
    }

    console.log(`📧 Inbound email reply from ${replyEmail}`);

    // Find lead by email address
    const [lead] = await db
      .select({ id: leads.id, organizationId: leads.organizationId })
      .from(leads)
      .where(eq(leads.email, replyEmail))
      .limit(1);

    if (!lead) {
      console.log(`Email reply webhook: no lead found for ${replyEmail}`);
      return res.sendStatus(200);
    }

    // Check for active enrollment in email_sent state
    const [emailEnrollment] = await db
      .select()
      .from(sdrEnrollments)
      .where(and(
        eq(sdrEnrollments.leadId, lead.id),
        eq(sdrEnrollments.status, "email_sent"),
      ))
      .orderBy(desc(sdrEnrollments.updatedAt))
      .limit(1);

    if (emailEnrollment) {
      // Cancel the EMAIL_TIMEOUT job — lead responded, don't exhaust the sequence
      if (emailEnrollment.bullmqJobId) {
        await cancelJob(emailEnrollment.bullmqJobId);
      }
      await stateMachine.transition(emailEnrollment.id, "email_replied", {
        replySubject: subject?.substring(0, 200),
        replyText:    text?.substring(0, 500),
        from: replyEmail,
      });
      console.log(`✅ SDR: Email reply from ${replyEmail} — enrollment ${emailEnrollment.id} → email_replied`);
    }

    // Log activity to CRM regardless of SDR state
    await storage.logActivity({
      entityType:     "lead",
      entityId:       lead.id,
      action:         "email_received",
      details:        `Inbound email reply from ${replyEmail}: ${(subject || "").substring(0, 100)}`,
      organizationId: lead.organizationId,
    });

    res.sendStatus(200);
  } catch (error: any) {
    console.error("Email reply webhook error:", error.message);
    res.sendStatus(200); // Always 200 — never cause SendGrid to retry
  }
});

export default router;
