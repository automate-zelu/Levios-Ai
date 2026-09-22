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
import { sendOutboundSms } from "./telephony.js";
import { sendEmailViaGmail } from "./gmail/send.js";
import { storage } from "./storage.js";
import {
  bookAppointmentWithCalendar,
  getCalendarAvailability,
  getCalendarBookingPrefs,
} from "./calendar/service.js";

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
  calendarSynced?: boolean;
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
  if (/\b(no|nope|not interested|stop|unsubscribe|don'?t|do not|remove|leave me alone|busy|wrong number)\b/.test(t)) {
    return "disagree";
  }
  if (/\b(yes|yeah|yep|sure|ok|okay|absolutely|definitely|sounds good|i'?d love|love to|interested|let'?s do|book|schedule|works for me)\b/.test(t)) {
    return "agree";
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

async function resolveOrgId(workspaceId: string): Promise<number | null> {
  const [ws] = await db
    .select({ organizationId: workspaces.organizationId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  return ws?.organizationId ?? null;
}

export function wantsSchedulingHelp(text: string, intent: FollowupIntent): boolean {
  if (intent === "agree") return true;
  const t = (text || "").toLowerCase();
  return /\b(available|availability|schedule|book|meeting|call|slot|time|when can|what times)\b/.test(t);
}

const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - date.getTime();
}

function zonedWallToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let date = new Date(utcGuess);
  date = new Date(utcGuess - tzOffsetMs(date, timeZone));
  return new Date(utcGuess - tzOffsetMs(date, timeZone));
}

function partsInZone(now: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const p = Object.fromEntries(dtf.formatToParts(now).map((x) => [x.type, x.value]));
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: p.hour === "24" ? 0 : Number(p.hour),
    minute: Number(p.minute),
    weekday: map[p.weekday] ?? 0,
  };
}

function parseClock(rawHour: string, rawMin: string | undefined, ampm: string | undefined): { h: number; m: number } | null {
  let h = Number(rawHour);
  const m = rawMin ? Number(rawMin) : 0;
  if (!Number.isFinite(h) || !Number.isFinite(m) || m > 59) return null;
  const mer = (ampm || "").toLowerCase();
  if (mer === "pm" && h < 12) h += 12;
  if (mer === "am" && h === 12) h = 0;
  if (h > 23) return null;
  return { h, m };
}

/**
 * Parse a concrete local appointment time from SMS/email without calling the LLM.
 * Examples: "Tue 3pm", "tomorrow at 10:30 am", "Monday 2:00 PM".
 */
export function parseLooseAppointmentTime(
  text: string,
  now = new Date(),
  timeZone = "America/New_York"
): Date | null {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const iso = raw.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  if (iso) {
    const d = new Date(iso[0]);
    if (!Number.isNaN(d.getTime()) && d.getTime() > now.getTime() - 60_000) return d;
  }

  const clock = raw.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!clock) return null;
  const hm = parseClock(clock[1], clock[2], clock[3]);
  if (!hm) return null;

  const local = partsInZone(now, timeZone);
  const lower = raw.toLowerCase();
  let year = local.year;
  let month = local.month;
  let day = local.day;

  if (/\btomorrow\b/.test(lower)) {
    const t = zonedWallToUtc(timeZone, year, month, day, 12, 0);
    const next = new Date(t.getTime() + 24 * 60 * 60 * 1000);
    const n = partsInZone(next, timeZone);
    year = n.year;
    month = n.month;
    day = n.day;
  } else {
    const dayMatch = lower.match(
      /\b(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?)\b/
    );
    if (dayMatch) {
      const token = dayMatch[1];
      const key = token.startsWith("tue") ? "tue" : token.startsWith("thu") ? "thu" : token.slice(0, 3);
      const target = WEEKDAY_INDEX[key];
      let delta = (target - local.weekday + 7) % 7;
      if (delta === 0) {
        const todayAt = zonedWallToUtc(timeZone, year, month, day, hm.h, hm.m);
        if (todayAt.getTime() <= now.getTime() + 60_000) delta = 7;
      }
      const t = zonedWallToUtc(timeZone, year, month, day, 12, 0);
      const next = new Date(t.getTime() + delta * 24 * 60 * 60 * 1000);
      const n = partsInZone(next, timeZone);
      year = n.year;
      month = n.month;
      day = n.day;
    } else if (!/\btoday\b/.test(lower)) {
      return null;
    }
  }

  const when = zonedWallToUtc(timeZone, year, month, day, hm.h, hm.m);
  if (when.getTime() <= now.getTime() - 60_000) return null;
  return when;
}

export type FollowupScheduleDecision = {
  reply: string;
  bookedAppt: boolean;
  calendarSynced: boolean;
  scheduledAt?: string;
  syncError?: string;
};

export type FollowupAvailabilityView = {
  connected: boolean;
  error?: string;
  slots: Array<{ start: string; end: string; label: string }>;
  prefs?: { offerCount?: number; daysAhead?: number };
};

/** Pure SMS/email calendar reply mapper — unit-tested without Twilio/Google. */
export function mapFollowupScheduleReply(opts: {
  channel: "sms" | "email";
  firstName: string;
  companyName: string;
  draftReply: string;
  intent: FollowupIntent;
  inboundText: string;
  extractedAt: Date | null;
  bookResult: { appointmentId?: number | string | null; synced: boolean; syncError?: string } | null;
  availability: FollowupAvailabilityView | null;
  timezone?: string;
}): FollowupScheduleDecision {
  const name = (opts.firstName || "").trim() || "there";
  const brand = (opts.companyName || "").trim() || "our team";
  const sms = opts.channel === "sms";

  if (!wantsSchedulingHelp(opts.inboundText, opts.intent)) {
    return { reply: opts.draftReply, bookedAppt: false, calendarSynced: false };
  }

  if (opts.extractedAt && opts.bookResult?.appointmentId) {
    const whenLabel = opts.extractedAt.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: opts.timezone || "America/New_York",
    });
    const syncNote = opts.bookResult.synced ? "" : " I'll sync Google Calendar shortly.";
    const reply = sms
      ? `You're booked, ${name}! ${whenLabel} is locked in.${syncNote} Talk soon — ${brand}.`
      : `Hi ${name},\n\nYou're confirmed for ${whenLabel}.${syncNote}\n\nLooking forward to speaking,\n${brand}`;
    return {
      reply: reply.replace(/ \./g, ".").replace(/\s{2,}/g, " ").trim(),
      bookedAppt: true,
      calendarSynced: Boolean(opts.bookResult.synced),
      scheduledAt: opts.extractedAt.toISOString(),
      syncError: opts.bookResult.synced ? undefined : opts.bookResult.syncError,
    };
  }

  if (opts.extractedAt && opts.bookResult && !opts.bookResult.appointmentId) {
    const fail = sms
      ? `${name}, booking failed on our side — please try another time that works.`
      : `Hi ${name},\n\nBooking failed on our side just now. Please reply with another time.\n\nBest,\n${brand}`;
    return {
      reply: fail,
      bookedAppt: false,
      calendarSynced: false,
      scheduledAt: opts.extractedAt.toISOString(),
      syncError: opts.bookResult.syncError,
    };
  }

  const slots = opts.availability?.slots || [];
  const offerCount = opts.availability?.prefs?.offerCount ?? 3;
  const offered = slots.slice(0, offerCount);
  if (offered.length) {
    const slotText = offered.map((s) => s.label).join("; ");
    const reply = sms
      ? `Great, ${name}! Open times: ${slotText}. Reply with the one you want and I'll book it.`
      : `Hi ${name},\n\nHere are open times:\n\n${offered.map((s) => `• ${s.label}`).join("\n")}\n\nReply with the slot you want and I'll book it.\n\nBest,\n${brand}`;
    return { reply, bookedAppt: false, calendarSynced: !opts.availability?.error };
  }

  const daysAhead = opts.availability?.prefs?.daysAhead ?? 5;
  if (opts.availability && !opts.availability.error) {
    const none = sms
      ? `${name}, I don't have open slots in the next ${daysAhead} days. Reply with a preferred day/time and I'll check again.`
      : `Hi ${name},\n\nI don't have open slots in the next ${daysAhead} days. Reply with a preferred day or time window and I'll check again.\n\nBest,\n${brand}`;
    return { reply: none, bookedAppt: false, calendarSynced: true };
  }

  const fail = sms
    ? `Thanks ${name}! Reply with a couple of times that work (for example Tue 3pm) and I'll lock one in.`
    : `Hi ${name},\n\nThanks for getting back. Please reply with a couple of times that work and I'll lock one in.\n\nBest,\n${brand}`;
  return {
    reply: fail,
    bookedAppt: false,
    calendarSynced: false,
    syncError: opts.availability?.error,
  };
}

/** Pull an ISO datetime from free text when the lead names a slot. */
export async function extractScheduledAtFromText(
  text: string,
  now = new Date(),
  timeZone = "America/New_York"
): Promise<Date | null> {
  const heuristic = parseLooseAppointmentTime(text, now, timeZone);
  if (heuristic) return heuristic;

  const raw = String(text || "").trim();
  if (!raw) return null;
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
        `Today is ${now.toISOString()}. Timezone ${timeZone}. Return null if only vague interest with no time.\n\nMessage:\n${raw}`
    );
    if (!result.scheduledAt) return null;
    const d = new Date(result.scheduledAt);
    if (Number.isNaN(d.getTime()) || d.getTime() < now.getTime() - 60_000) return null;
    return d;
  } catch {
    return null;
  }
}

/** Book if a concrete time is present; otherwise offer open slots (FreeBusy or working-hours fallback). */
export async function resolveFollowupScheduling(opts: {
  workspaceId: string;
  leadId: number;
  inboundText: string;
  channel: "sms" | "email";
  intent: FollowupIntent;
  firstName: string;
  companyName: string;
  draftReply: string;
}): Promise<FollowupScheduleDecision> {
  const orgId = await resolveOrgId(opts.workspaceId);

  if (!orgId || !wantsSchedulingHelp(opts.inboundText, opts.intent)) {
    return { reply: opts.draftReply, bookedAppt: false, calendarSynced: false };
  }

  const prefs = await getCalendarBookingPrefs(orgId);
  const scheduledAt = await extractScheduledAtFromText(opts.inboundText, new Date(), prefs.timezone);

  if (scheduledAt) {
    try {
      const lead = await storage.getLead(opts.leadId);
      const result = await bookAppointmentWithCalendar({
        organizationId: orgId,
        leadId: opts.leadId,
        title: "Consultation",
        scheduledAt,
        durationMinutes: prefs.durationMinutes,
        attendeeEmail: lead?.email,
        attendeeName: lead
          ? [lead.firstName, lead.lastName].filter(Boolean).join(" ")
          : null,
        description: `Booked via ${opts.channel} follow-up`,
        timezone: prefs.timezone,
      });
      return mapFollowupScheduleReply({
        channel: opts.channel,
        firstName: opts.firstName,
        companyName: opts.companyName,
        draftReply: opts.draftReply,
        intent: opts.intent,
        inboundText: opts.inboundText,
        extractedAt: scheduledAt,
        bookResult: {
          appointmentId: result.appointmentId,
          synced: result.synced,
          syncError: result.syncError,
        },
        availability: null,
        timezone: prefs.timezone,
      });
    } catch (err: any) {
      console.warn(`Follow-up calendar book failed: ${err?.message || err}`);
      return mapFollowupScheduleReply({
        channel: opts.channel,
        firstName: opts.firstName,
        companyName: opts.companyName,
        draftReply: opts.draftReply,
        intent: opts.intent,
        inboundText: opts.inboundText,
        extractedAt: scheduledAt,
        bookResult: { appointmentId: null, synced: false, syncError: err?.message },
        availability: null,
        timezone: prefs.timezone,
      });
    }
  }

  try {
    const avail = await getCalendarAvailability({ organizationId: orgId });
    return mapFollowupScheduleReply({
      channel: opts.channel,
      firstName: opts.firstName,
      companyName: opts.companyName,
      draftReply: opts.draftReply,
      intent: opts.intent,
      inboundText: opts.inboundText,
      extractedAt: null,
      bookResult: null,
      availability: {
        connected: avail.connected,
        error: avail.error,
        slots: avail.slots,
        prefs: avail.prefs || prefs,
      },
      timezone: prefs.timezone,
    });
  } catch (err: any) {
    console.warn(`Follow-up availability check failed: ${err?.message || err}`);
    return mapFollowupScheduleReply({
      channel: opts.channel,
      firstName: opts.firstName,
      companyName: opts.companyName,
      draftReply: opts.draftReply,
      intent: opts.intent,
      inboundText: opts.inboundText,
      extractedAt: null,
      bookResult: null,
      availability: { connected: false, error: err?.message, slots: [], prefs },
      timezone: prefs.timezone,
    });
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
  const generated = await generateFollowupReply({
    channel: "sms",
    firstName,
    companyName,
    inboundText: opts.inboundText,
  });
  const intent = generated.intent;
  let reply = generated.reply;

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

  const afterStatus = (
    await db.select({ status: sdrEnrollments.status }).from(sdrEnrollments).where(eq(sdrEnrollments.id, opts.enrollmentId))
  )[0]?.status as EnrollmentStatus | undefined;

  // Live calendar: book confirmed slots or offer real availability; rewrite reply accordingly
  const scheduling = await resolveFollowupScheduling({
    workspaceId: opts.workspaceId,
    leadId: opts.lead.id,
    inboundText: opts.inboundText,
    channel: "sms",
    intent,
    firstName,
    companyName,
    draftReply: reply,
  });
  reply = scheduling.reply;

  let booked = false;
  if (scheduling.bookedAppt && afterStatus && stateMachine.canTransition(afterStatus, "booked")) {
    await stateMachine.transition(opts.enrollmentId, "booked", {
      channel: "sms",
      reason: "lead_agreed_via_sms",
      intent,
      scheduledAt: scheduling.scheduledAt,
      calendarSynced: scheduling.calendarSynced,
    });
    booked = true;
  } else if (scheduling.bookedAppt) {
    booked = true;
  } else if (intent === "disagree" && afterStatus && stateMachine.canTransition(afterStatus, "exhausted")) {
    await stateMachine.transition(opts.enrollmentId, "exhausted", {
      channel: "sms",
      reason: "lead_declined_via_sms",
      intent,
    });
  }

  // Send conversational reply via workspace BYOT provider
  let sent = false;
  let error: string | undefined;
  try {
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, opts.workspaceId));
    if (!ws) throw new Error("Workspace not found");
    if (!opts.lead.phone) throw new Error("Lead has no phone");

    const delivered = await sendOutboundSms(ws, { to: opts.lead.phone, body: reply });
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
      payload: {
        channel: "sms",
        direction: "outbound",
        body: reply,
        intent,
        to: opts.lead.phone,
        from: delivered.from,
        provider: delivered.provider,
      },
      loggedAt: new Date(),
    });
  } catch (err: any) {
    error = err.message;
    console.error("SDR SMS conversational reply failed:", err.message);
  }

  return { intent, replyText: reply, sent, booked, calendarSynced: scheduling.calendarSynced, error, twimlMessage: escapeXml(reply) };
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
  const generated = await generateFollowupReply({
    channel: "email",
    firstName,
    companyName,
    inboundText: opts.inboundText,
    inboundSubject: opts.inboundSubject,
  });
  const intent = generated.intent;
  let reply = generated.reply;

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

  const scheduling = await resolveFollowupScheduling({
    workspaceId: opts.workspaceId,
    leadId: opts.lead.id,
    inboundText: `${opts.inboundSubject || ""}\n${opts.inboundText}`,
    channel: "email",
    intent,
    firstName,
    companyName,
    draftReply: reply,
  });
  reply = scheduling.reply;

  let booked = false;
  if (scheduling.bookedAppt && afterStatus && stateMachine.canTransition(afterStatus, "booked")) {
    await stateMachine.transition(opts.enrollmentId, "booked", {
      channel: "email",
      reason: "lead_agreed_via_email",
      intent,
      scheduledAt: scheduling.scheduledAt,
      calendarSynced: scheduling.calendarSynced,
    });
    booked = true;
  } else if (scheduling.bookedAppt) {
    booked = true;
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
        booked,
        calendarSynced: scheduling.calendarSynced,
        scheduledAt: scheduling.scheduledAt,
      },
      loggedAt: new Date(),
    });
  } catch (err: any) {
    error = err.message;
    console.error("SDR email conversational reply failed:", err.message);
  }

  return { intent, replyText: reply, sent, booked, calendarSynced: scheduling.calendarSynced, error };
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
