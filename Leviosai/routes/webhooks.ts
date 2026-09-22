import { Router, Request, Response } from "express";
import { storage } from "../lib/storage.js";
import { Reactor } from "../reactor/reactor.js";
import { db } from "../lib/db.js";
import { organizations, sdrEnrollments, leads } from "../lib/schema.js";
import { eq, and, desc, inArray } from "drizzle-orm";
import { cancelJob } from "../lib/sdr-queue.js";
import { validateTwilioSms, validateTwilioGeneric } from "../middleware/twilioSignature.js";
import {
  handleSdrEmailConversation,
  handleSdrSmsConversation,
} from "../lib/sdr-followup-reply.js";

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
    let twimlBody = "";

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

      // Active SDR conversation via SMS — include email_* so late SMS replies
      // still get an AI response after SMS timed out and email already went out.
      const [smsEnrollment] = await db
        .select()
        .from(sdrEnrollments)
        .where(and(
          eq(sdrEnrollments.leadId, lead.id),
          inArray(sdrEnrollments.status, [
            "sms_sent",
            "sms_replied",
            "email_sent",
            "email_replied",
          ]),
        ))
        .orderBy(desc(sdrEnrollments.updatedAt))
        .limit(1);

      if (smsEnrollment) {
        if (
          (smsEnrollment.status === "sms_sent" || smsEnrollment.status === "email_sent") &&
          smsEnrollment.bullmqJobId
        ) {
          await cancelJob(smsEnrollment.bullmqJobId);
        }

        const result = await handleSdrSmsConversation({
          enrollmentId: smsEnrollment.id,
          lead: {
            id: lead.id,
            firstName: lead.firstName,
            phone: lead.phone,
          },
          workspaceId: smsEnrollment.workspaceId,
          inboundText: Body,
          fromPhone: From,
        });

        console.log(
          `✅ SDR: SMS conversation from ${From} — intent=${result.intent} sent=${result.sent} booked=${!!result.booked}`
        );

        // Prefer Twilio REST send (already done); empty TwiML avoids duplicate SMS.
        // If REST send failed, fall back to TwiML Message.
        if (!result.sent && result.twimlMessage) {
          twimlBody = result.twimlMessage;
        }
      }

      await storage.logActivity({
        entityType: "lead",
        entityId: lead.id,
        action: "sms_received",
        details: `Inbound SMS from ${From}: ${Body.substring(0, 100)}`,
        organizationId: lead.organizationId,
      });

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

    if (twimlBody) {
      res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${twimlBody}</Message></Response>`);
    } else {
      res.type("text/xml").send("<Response></Response>");
    }
  } catch (error: any) {
    console.error("Twilio SMS webhook error:", error.message);
    res.type("text/xml").send("<Response></Response>");
  }
});

// ─── Telnyx inbound SMS (Mission Control → Messaging Profile webhook) ─────────
// Accepts Telnyx JSON event payloads (message.received) and TeXML-style form bodies.
router.post("/api/webhooks/telnyx/sms", async (req: Request, res: Response) => {
  try {
    const payload = req.body?.data?.payload || req.body?.payload || req.body || {};
    const From =
      payload.from?.phone_number ||
      payload.from?.phoneNumber ||
      payload.From ||
      payload.from ||
      "";
    const Body =
      payload.text ||
      payload.body ||
      payload.Body ||
      "";
    const MessageSid =
      payload.id ||
      payload.message_id ||
      payload.MessageSid ||
      req.body?.data?.id ||
      "";

    if (!From || !Body) {
      return res.sendStatus(200);
    }

    console.log(`📩 Inbound Telnyx SMS from ${From}: ${String(Body).substring(0, 50)}...`);

    const lead = await storage.getLeadByPhone(From);

    if (lead) {
      await storage.createLeadMessage({
        leadId: lead.id,
        channel: "sms",
        content: Body,
        status: "delivered",
        direction: "inbound",
        aiGenerated: false,
      });

      const [smsEnrollment] = await db
        .select()
        .from(sdrEnrollments)
        .where(and(
          eq(sdrEnrollments.leadId, lead.id),
          inArray(sdrEnrollments.status, [
            "sms_sent",
            "sms_replied",
            "email_sent",
            "email_replied",
          ]),
        ))
        .orderBy(desc(sdrEnrollments.updatedAt))
        .limit(1);

      if (smsEnrollment) {
        if (
          (smsEnrollment.status === "sms_sent" || smsEnrollment.status === "email_sent") &&
          smsEnrollment.bullmqJobId
        ) {
          await cancelJob(smsEnrollment.bullmqJobId);
        }

        const result = await handleSdrSmsConversation({
          enrollmentId: smsEnrollment.id,
          lead: {
            id: lead.id,
            firstName: lead.firstName,
            phone: lead.phone,
          },
          workspaceId: smsEnrollment.workspaceId,
          inboundText: Body,
          fromPhone: From,
        });

        console.log(
          `✅ SDR: Telnyx SMS conversation from ${From} — intent=${result.intent} sent=${result.sent} booked=${!!result.booked}`
        );
      }

      await storage.logActivity({
        entityType: "lead",
        entityId: lead.id,
        action: "sms_received",
        details: `Inbound Telnyx SMS from ${From}: ${String(Body).substring(0, 100)}`,
        organizationId: lead.organizationId,
      });

      if (await isReactorEnabled(lead.organizationId)) {
        const reactor = Reactor.getInstance();
        reactor.emit({
          type: "webhook.telnyx.sms",
          organizationId: lead.organizationId!,
          payload: { from: From, body: Body, messageSid: MessageSid, leadId: lead.id },
          metadata: { leadId: lead.id, priority: 2, agentSource: "telnyx-webhook" },
        });
      }
    } else {
      console.log(`⚠️  Inbound Telnyx SMS from unknown number: ${From}`);
    }

    res.sendStatus(200);
  } catch (error: any) {
    console.error("Telnyx SMS webhook error:", error.message);
    res.sendStatus(200);
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

// ─── Inbound email reply webhook (SendGrid Inbound Parse or similar) ─────────
router.post("/api/webhooks/email/reply", async (req: Request, res: Response) => {
  try {
    const from    = req.body.from    as string | undefined;
    const subject = req.body.subject as string | undefined;
    const text    = req.body.text    as string | undefined;

    if (!from) {
      return res.sendStatus(200);
    }

    const emailMatch = from.match(/<([^>]+)>/) ?? from.match(/\S+@\S+/);
    const replyEmail = emailMatch ? (emailMatch[1] ?? emailMatch[0]).toLowerCase().trim() : null;

    if (!replyEmail) {
      console.log("Email reply webhook: could not parse sender address from:", from);
      return res.sendStatus(200);
    }

    console.log(`📧 Inbound email reply from ${replyEmail}`);

    const [lead] = await db
      .select({
        id: leads.id,
        organizationId: leads.organizationId,
        firstName: leads.firstName,
        email: leads.email,
      })
      .from(leads)
      .where(eq(leads.email, replyEmail))
      .limit(1);

    if (!lead) {
      console.log(`Email reply webhook: no lead found for ${replyEmail}`);
      return res.sendStatus(200);
    }

    try {
      await storage.createLeadMessage({
        leadId: lead.id,
        channel: "email",
        content: subject ? `Subject: ${subject}\n\n${text || ""}` : (text || "(empty reply)"),
        status: "delivered",
        direction: "inbound",
        aiGenerated: false,
      });
    } catch (err: any) {
      console.warn("Email reply: failed to store lead message:", err.message);
    }

    const [emailEnrollment] = await db
      .select()
      .from(sdrEnrollments)
      .where(and(
        eq(sdrEnrollments.leadId, lead.id),
        inArray(sdrEnrollments.status, ["email_sent", "email_replied"]),
      ))
      .orderBy(desc(sdrEnrollments.updatedAt))
      .limit(1);

    if (emailEnrollment && lead.organizationId) {
      if (emailEnrollment.status === "email_sent" && emailEnrollment.bullmqJobId) {
        await cancelJob(emailEnrollment.bullmqJobId);
      }

      const result = await handleSdrEmailConversation({
        enrollmentId: emailEnrollment.id,
        lead,
        workspaceId: emailEnrollment.workspaceId,
        organizationId: lead.organizationId,
        inboundText: text || subject || "",
        inboundSubject: subject,
        fromEmail: replyEmail,
      });

      console.log(
        `✅ SDR: Email conversation from ${replyEmail} — intent=${result.intent} sent=${result.sent} booked=${!!result.booked}`
      );
    }

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
    res.sendStatus(200);
  }
});

export default router;
