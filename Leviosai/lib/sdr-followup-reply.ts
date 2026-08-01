// ─── SDR follow-up conversation replies (SMS / email) ────────────────────────
// When a lead replies to an outbound SMS or email, classify intent and send a
// short conversational reply that addresses them by first name.

import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { db } from "./db.js";
import { sdrEnrollments, sdrLogs, workspaces, organizations } from "./schema.js";
import type { EnrollmentStatus } from "./schema.js";
import { eq } from "drizzle-orm";
import { stateMachine } from "./sdr-state-machine.js";
import { getClientForWorkspace } from "./twilio-subaccount.js";
import { sendEmailViaGmail } from "./gmail/send.js";
import { storage } from "./storage.js";
import { bookAppointmentWithCalendar } from "./calendar/service.js";

export type FollowupIntent = "agree" | "disagree" | "question" | "other";

const replySchema = z.object({
  intent: z.enum(["agree", "disagree", "question", "other"]),
  reply: z
    .string()
    .describe("Short conversational reply that uses the lead's first name. SMS: under 280 chars. Email: 2-5 sentences."),
});

export interface FollowupReplyResult {
  intent: FollowupIntent;
  replyText: string;
  sent: boolean;
  booked?: boolean;
  error?: string;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Heuristic fallback when OpenAI is unavailable. */
export function classifyIntentHeuristic(text: string): FollowupIntent {
  const t = (text || "").toLowerCase().trim();
  if (!t) return "other";
  if (/\b(yes|yeah|yep|sure|ok|okay|absolutely|definitely|sounds good|i'?d love|love to|interested|let'?s do|book|schedule|works for me)\b/.test(t)) {
    return "agree";
  }
  if (/\b(no|nope|not interested|stop|unsubscribe|don'?t|do not|remove|leave me alone|busy|wrong number)\b/.test(t)) {
    return "disagree";
  }
  if (/\?|how|when|what|who|where|why|can you|could you|available/.test(t)) {
    return "question";
  }
  return "other";
}

function heuristicReply(intent: FollowupIntent, firstName: string, company: string, channel: "sms" | "email"): string {
  const name = firstName || "there";
  const brand = company || "our team";
  if (channel === "sms") {
    switch (intent) {
      case "agree":
        return `Awesome, ${name}! I'll get you on the calendar with ${brand}. What days this week work best for a quick 10-min call?`;
      case "disagree":
        return `No worries at all, ${name} — thanks for letting me know. If timing gets better later, just reply here anytime.`;
      case "question":
        return `Great question, ${name}. Happy to help — what would you like to know, or want me to suggest a couple of times for a quick chat?`;
      default:
        return `Thanks for getting back, ${name}. Would a short 10-minute call with ${brand} this week help, or is there a better way I can assist?`;
    }
  }
  switch (intent) {
    case "agree":
      return `Hi ${name},\n\nFantastic — glad you're open to connecting. Reply with a couple of times that work this week and I'll lock in a quick 10-minute call with ${brand}.\n\nTalk soon,\n${brand}`;
    case "disagree":
      return `Hi ${name},\n\nTotally understand — thanks for the honest reply. I won't keep chasing. If things change, you're always welcome to write back.\n\nBest,\n${brand}`;
    case "question":
      return `Hi ${name},\n\nThanks for the note — happy to answer. Share whatever is on your mind (or a few times that work) and I'll follow up right away.\n\nBest,\n${brand}`;
    default:
      return `Hi ${name},\n\nThanks for writing back. Would a brief 10-minute call this week be useful, or is there something specific I can help with over email?\n\nBest,\n${brand}`;
  }
}

/** Pull an ISO datetime from free text when the lead names a slot. */
export async function extractScheduledAtFromText(text: string): Promise<Date | null> {
  const raw = String(text || "").trim();
  if (!raw) return null;

  // Direct ISO / obvious datetime
  const iso = raw.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  if (iso) {
    const d = new Date(iso[0]);
    if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now() - 60_000) return d;
  }

  if (!process.env.OPENAI_API_KEY) return null;

  try {
    const llm = new ChatOpenAI({
      model: "gpt-4o-mini",
      temperature: 0,
      openAIApiKey: process.env.OPENAI_API_KEY,
    });
    const schema = z.object({
      scheduledAt: z
        .string()
        .nullable()
        .describe("ISO-8601 UTC datetime if a specific future meeting time was stated, else null"),
    });
    const structured = llm.withStructuredOutput(schema);
    const result = await structured.invoke(
      `Extract a specific future appointment datetime from this message if clearly stated. ` +
        `Today is ${new Date().toISOString()}. Return null if only vague interest with no time.\n\nMessage:\n${raw}`
    );
    if (!result.scheduledAt) return null;
    const d = new Date(result.scheduledAt);
    if (Number.isNaN(d.getTime()) || d.getTime() < Date.now() - 60_000) return null;
    return d;
  } catch {
    return null;
  }
}

async function maybeBookFollowupAppointment(opts: {
  workspaceId: string;
  leadId: number;
  inboundText: string;
  channel: "sms" | "email";
}): Promise<{ bookedAppt: boolean; scheduledAt?: string }> {
  const scheduledAt = await extractScheduledAtFromText(opts.inboundText);
  if (!scheduledAt) return { bookedAppt: false };

  const [ws] = await db
    .select({ organizationId: workspaces.organizationId })
    .from(workspaces)
    .where(eq(workspaces.id, opts.workspaceId));
  if (!ws?.organizationId) return { bookedAppt: false };

  try {
    const lead = await storage.getLead(opts.leadId);
    await bookAppointmentWithCalendar({
      organizationId: ws.organizationId,
      leadId: opts.leadId,
      title: "Consultation",
      scheduledAt,
      attendeeEmail: lead?.email,
      attendeeName: lead
        ? [lead.firstName, lead.lastName].filter(Boolean).join(" ")
        : null,
      description: `Booked via ${opts.channel} follow-up`,
    });
    return { bookedAppt: true, scheduledAt: scheduledAt.toISOString() };
  } catch (err: any) {
    console.warn(`Follow-up calendar book failed: ${err?.message || err}`);
    return { bookedAppt: false };
  }
}

async function generateFollowupReply(opts: {
  channel: "sms" | "email";
  firstName: string;
  companyName: string;
  inboundText: string;
  inboundSubject?: string;
}): Promise<{ intent: FollowupIntent; reply: string }> {
  const firstName = (opts.firstName || "").trim() || "there";
  const company = (opts.companyName || "").trim() || "our team";

  if (!process.env.OPENAI_API_KEY) {
    const intent = classifyIntentHeuristic(opts.inboundText);
    return { intent, reply: heuristicReply(intent, firstName, company, opts.channel) };
  }

  try {
    const llm = new ChatOpenAI({
      model: "gpt-4o-mini",
      temperature: 0.5,
      openAIApiKey: process.env.OPENAI_API_KEY,
    }).withStructuredOutput(replySchema);

    const channelRules =
      opts.channel === "sms"
        ? "Write ONE SMS under 280 characters. No emoji spam. No markdown."
        : "Write a short email body (2-5 sentences). No subject line. Warm and professional.";

    const result = await llm.invoke([
      {
        role: "system",
        content:
          `You are a friendly SDR for ${company}. Always address the lead as ${firstName} by name. ` +
          `Classify their reply intent and write a conversational response. ` +
          `If they agree to meet/chat: confirm enthusiastically and ask for best times. ` +
          `If they disagree/opt out: be gracious, brief, no pressure. ` +
          `If they ask a question: answer helpfully and offer a short call. ` +
          channelRules,
      },
      {
        role: "user",
        content:
          `Lead first name: ${firstName}\nCompany: ${company}\n` +
          (opts.inboundSubject ? `Email subject: ${opts.inboundSubject}\n` : "") +
          `Lead replied:\n${opts.inboundText}`,
      },
    ]);

    const intent = (result.intent || classifyIntentHeuristic(opts.inboundText)) as FollowupIntent;
    let reply = (result.reply || "").trim();
    if (!reply) reply = heuristicReply(intent, firstName, company, opts.channel);
    // Ensure name appears at least once
    if (firstName !== "there" && !new RegExp(firstName, "i").test(reply)) {
      reply = opts.channel === "sms" ? `${firstName}, ${reply}` : `Hi ${firstName},\n\n${reply}`;
    }
    if (opts.channel === "sms" && reply.length > 320) reply = reply.slice(0, 317) + "…";
    return { intent, reply };
  } catch (err: any) {
    console.warn("SDR follow-up LLM failed, using heuristic:", err.message);
    const intent = classifyIntentHeuristic(opts.inboundText);
    return { intent, reply: heuristicReply(intent, firstName, company, opts.channel) };
  }
}

async function loadCompanyName(workspaceId: string): Promise<string> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws?.organizationId) return "";
  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, ws.organizationId));
  return org?.name || ws.name || "";
}

/**
 * Handle an inbound SMS during/after the SDR SMS step: classify, reply, update enrollment.
 * Returns optional TwiML message body (already escaped) for Twilio <Message>.
 */
export async function handleSdrSmsConversation(opts: {
  enrollmentId: string;
  lead: { id: number; firstName?: string | null; phone?: string | null };
  workspaceId: string;
  inboundText: string;
  fromPhone: string;
}): Promise<FollowupReplyResult & { twimlMessage?: string }> {
  const companyName = await loadCompanyName(opts.workspaceId);
  const firstName = (opts.lead.firstName || "").trim();
  const { intent, reply } = await generateFollowupReply({
    channel: "sms",
    firstName,
    companyName,
    inboundText: opts.inboundText,
  });

  const [enrollment] = await db
    .select()
    .from(sdrEnrollments)
    .where(eq(sdrEnrollments.id, opts.enrollmentId));
  if (!enrollment) return { intent, replyText: reply, sent: false, error: "enrollment_missing" };

  const status = enrollment.status as EnrollmentStatus;

  // Mark replied if still waiting on SMS; if sequence already moved to email,
  // treat the SMS as the reply on the email step so conversation continues.
  if (status === "sms_sent" && stateMachine.canTransition("sms_sent", "sms_replied")) {
    await stateMachine.transition(opts.enrollmentId, "sms_replied", {
      channel: "sms",
      direction: "inbound",
      replyText: opts.inboundText.substring(0, 500),
      intent,
      from: opts.fromPhone,
    });
  } else if (status === "email_sent" && stateMachine.canTransition("email_sent", "email_replied")) {
    // Status advances on the email step, but the reply arrived by SMS — log it as SMS.
    await stateMachine.transition(
      opts.enrollmentId,
      "email_replied",
      {
        channel: "sms",
        direction: "inbound",
        replyText: opts.inboundText.substring(0, 500),
        intent,
        from: opts.fromPhone,
        via: "sms_after_email",
      },
      { logStepName: "sms_replied", logOutcome: "sms_replied" }
    );
  } else {
    await db.insert(sdrLogs).values({
      workspaceId: opts.workspaceId,
      enrollmentId: opts.enrollmentId,
      leadId: opts.lead.id,
      step: enrollment.currentStep,
      stepName: "sms_conversation",
      outcome: intent,
      payload: { replyText: opts.inboundText.substring(0, 500), intent, from: opts.fromPhone },
      loggedAt: new Date(),
    });
  }

  // Book on clear agreement
  const afterStatus = (
    await db.select({ status: sdrEnrollments.status }).from(sdrEnrollments).where(eq(sdrEnrollments.id, opts.enrollmentId))
  )[0]?.status as EnrollmentStatus | undefined;

  let booked = false;
  if (intent === "agree" && afterStatus && stateMachine.canTransition(afterStatus, "booked")) {
    await stateMachine.transition(opts.enrollmentId, "booked", {
      channel: "sms",
      reason: "lead_agreed_via_sms",
      intent,
    });
    booked = true;
    await maybeBookFollowupAppointment({
      workspaceId: opts.workspaceId,
      leadId: opts.lead.id,
      inboundText: opts.inboundText,
      channel: "sms",
    });
  } else if (intent === "agree") {
    // Already booked or can't transition — still try to lock a calendar slot if time given
    await maybeBookFollowupAppointment({
      workspaceId: opts.workspaceId,
      leadId: opts.lead.id,
      inboundText: opts.inboundText,
      channel: "sms",
    });
  } else if (intent === "disagree" && afterStatus && stateMachine.canTransition(afterStatus, "exhausted")) {
    await stateMachine.transition(opts.enrollmentId, "exhausted", {
      channel: "sms",
      reason: "lead_declined_via_sms",
      intent,
    });
  }

  // Send conversational reply via Twilio
  let sent = false;
  let error: string | undefined;
  try {
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, opts.workspaceId));
    if (!ws) throw new Error("Workspace not found");
    const { client, fromNumber } = getClientForWorkspace(ws);
    if (!fromNumber) throw new Error("No Twilio number on workspace");
    if (!opts.lead.phone) throw new Error("Lead has no phone");

    await client.messages.create({
      body: reply,
      from: fromNumber,
      to: opts.lead.phone,
    });
    sent = true;

    await storage.createLeadMessage({
      leadId: opts.lead.id,
      channel: "sms",
      content: reply,
      status: "sent",
      direction: "outbound",
      aiGenerated: true,
    });

    await db.insert(sdrLogs).values({
      workspaceId: opts.workspaceId,
      enrollmentId: opts.enrollmentId,
      leadId: opts.lead.id,
      step: enrollment.currentStep,
      stepName: "sms_ai_reply",
      outcome: intent,
      payload: { channel: "sms", direction: "outbound", body: reply, intent, to: opts.lead.phone, from: fromNumber },
      loggedAt: new Date(),
    });
  } catch (err: any) {
    error = err.message;
    console.error("SDR SMS conversational reply failed:", err.message);
  }

  return { intent, replyText: reply, sent, booked, error, twimlMessage: escapeXml(reply) };
}

/**
 * Handle an inbound email reply during the SDR email step.
 */
export async function handleSdrEmailConversation(opts: {
  enrollmentId: string;
  lead: { id: number; firstName?: string | null; email?: string | null; organizationId?: number | null };
  workspaceId: string;
  organizationId: number;
  inboundText: string;
  inboundSubject?: string;
  fromEmail: string;
}): Promise<FollowupReplyResult> {
  const companyName = await loadCompanyName(opts.workspaceId);
  const firstName = (opts.lead.firstName || "").trim();
  const { intent, reply } = await generateFollowupReply({
    channel: "email",
    firstName,
    companyName,
    inboundText: opts.inboundText,
    inboundSubject: opts.inboundSubject,
  });

  const [enrollment] = await db
    .select()
    .from(sdrEnrollments)
    .where(eq(sdrEnrollments.id, opts.enrollmentId));
  if (!enrollment) return { intent, replyText: reply, sent: false, error: "enrollment_missing" };

  const status = enrollment.status as EnrollmentStatus;
  if (status === "email_sent" && stateMachine.canTransition("email_sent", "email_replied")) {
    await stateMachine.transition(opts.enrollmentId, "email_replied", {
      channel: "email",
      direction: "inbound",
      replyText: opts.inboundText.substring(0, 500),
      replySubject: opts.inboundSubject?.substring(0, 200),
      intent,
      from: opts.fromEmail,
    });
  }

  const afterStatus = (
    await db.select({ status: sdrEnrollments.status }).from(sdrEnrollments).where(eq(sdrEnrollments.id, opts.enrollmentId))
  )[0]?.status as EnrollmentStatus | undefined;

  let booked = false;
  if (intent === "agree" && afterStatus && stateMachine.canTransition(afterStatus, "booked")) {
    await stateMachine.transition(opts.enrollmentId, "booked", {
      channel: "email",
      reason: "lead_agreed_via_email",
      intent,
    });
    booked = true;
    await maybeBookFollowupAppointment({
      workspaceId: opts.workspaceId,
      leadId: opts.lead.id,
      inboundText: `${opts.inboundSubject || ""}\n${opts.inboundText}`,
      channel: "email",
    });
  } else if (intent === "agree") {
    await maybeBookFollowupAppointment({
      workspaceId: opts.workspaceId,
      leadId: opts.lead.id,
      inboundText: `${opts.inboundSubject || ""}\n${opts.inboundText}`,
      channel: "email",
    });
  } else if (intent === "disagree" && afterStatus && stateMachine.canTransition(afterStatus, "exhausted")) {
    await stateMachine.transition(opts.enrollmentId, "exhausted", {
      channel: "email",
      reason: "lead_declined_via_email",
      intent,
    });
  }

  const subject = opts.inboundSubject?.startsWith("Re:")
    ? opts.inboundSubject
    : `Re: ${opts.inboundSubject || `Following up with ${firstName || "you"}`}`;

  let sent = false;
  let error: string | undefined;
  try {
    const result = await sendEmailViaGmail(opts.organizationId, opts.fromEmail, subject, reply);
    if (!result.success) throw new Error(result.error || "Gmail send failed");
    sent = true;

    await storage.createLeadMessage({
      leadId: opts.lead.id,
      channel: "email",
      content: `Subject: ${subject}\n\n${reply}`,
      status: "sent",
      direction: "outbound",
      aiGenerated: true,
    });

    await db.insert(sdrLogs).values({
      workspaceId: opts.workspaceId,
      enrollmentId: opts.enrollmentId,
      leadId: opts.lead.id,
      step: enrollment.currentStep,
      stepName: "email_ai_reply",
      outcome: intent,
      payload: {
        channel: "email",
        direction: "outbound",
        subject,
        body: reply,
        intent,
        to: opts.fromEmail,
        from: result.from,
      },
      loggedAt: new Date(),
    });
  } catch (err: any) {
    error = err.message;
    console.error("SDR email conversational reply failed:", err.message);
  }

  return { intent, replyText: reply, sent, booked, error };
}

/** Suggested conversational templates (use {{first_name}} / {{company_name}}). */
export const CONVERSATIONAL_SMS_TEMPLATE =
  "Hi {{first_name}} — it's {{company_name}}. I tried reaching you earlier and would love to reconnect. Do you have 10 minutes this week for a quick chat? Just reply YES if you're open, or tell me a better time.";

export const CONVERSATIONAL_EMAIL_SUBJECT = "{{first_name}}, quick check-in from {{company_name}}";

export const CONVERSATIONAL_EMAIL_BODY =
  "Hi {{first_name}},\n\n" +
  "I hope you're doing well. I reached out recently and wanted to follow up personally from {{company_name}}.\n\n" +
  "Would you be open to a quick 10-minute call this week? If yes, just reply with a couple of times that work — or tell me if now isn't a fit.\n\n" +
  "Looking forward to hearing from you,\n" +
  "{{company_name}}";
