/**
 * Shared calendar tools for live-call agents (classic LangChain + OpenAI Realtime).
 */

import {
  getCalendarAvailability,
  getCalendarBookingPrefs,
  bookAppointmentWithCalendar,
} from "../calendar/service.js";

export interface CallToolContext {
  organizationId: number;
  leadId: number | null;
  midCallBooking: { scheduledAt: Date; appointmentId: number } | null;
  setMidCallBooking: (b: { scheduledAt: Date; appointmentId: number }) => void;
}

/** OpenAI Realtime / ChatCompletions function tool schemas. */
export const CALL_TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    name: "check_availability",
    description:
      "Check the connected Google Calendar for open appointment slots. Call this before offering times. Returns real open slots only.",
    parameters: {
      type: "object",
      properties: {
        daysAhead: { type: "number", description: "1-14 days ahead to search" },
        durationMinutes: { type: "number", description: "Slot length 15-120" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "book_appointment",
    description:
      "Book an appointment after the lead confirms a slot. Lead name/phone/email are already on the CRM record — do not require re-collection. Pass ISO-8601 start from check_availability.",
    parameters: {
      type: "object",
      properties: {
        scheduledAt: {
          type: "string",
          description:
            "ISO-8601 start datetime copied exactly from check_availability.slots[].start. Never invent dates.",
        },
        title: { type: "string" },
        durationMinutes: { type: "number" },
      },
      required: ["scheduledAt"],
      additionalProperties: false,
    },
  },
];

export async function executeCallTool(
  name: string,
  rawArgs: Record<string, unknown>,
  ctx: CallToolContext
): Promise<string> {
  if (name === "check_availability") {
    return checkAvailability(ctx, rawArgs);
  }
  if (name === "book_appointment") {
    return bookAppointment(ctx, rawArgs);
  }
  return JSON.stringify({ error: `Unknown tool ${name}` });
}

async function checkAvailability(
  ctx: CallToolContext,
  args: Record<string, unknown>
): Promise<string> {
  if (!ctx.organizationId) {
    return JSON.stringify({
      error: "Calendar not available for this call",
      slots: [],
      hint: "Apologize briefly and ask the lead to share preferred times, or offer to follow up by SMS later.",
    });
  }
  try {
    const prefs = await getCalendarBookingPrefs(ctx.organizationId);
    const result = await getCalendarAvailability({
      organizationId: ctx.organizationId,
      daysAhead: typeof args.daysAhead === "number" ? args.daysAhead : undefined,
      durationMinutes: typeof args.durationMinutes === "number" ? args.durationMinutes : undefined,
    });
    const offerCount = prefs.offerCount || 3;
    const slots = result.slots.slice(0, Math.max(offerCount + 2, offerCount));

    if (result.error || !result.connected) {
      return JSON.stringify({
        connected: result.connected,
        timezone: result.timezone,
        error: result.error || "Calendar unavailable",
        slots: [],
        hint:
          "Tell the lead the calendar is temporarily unavailable, ask them for preferred times, and say you will confirm shortly or they can try again later. Do not invent open slots.",
      });
    }

    return JSON.stringify({
      connected: result.connected,
      timezone: result.timezone,
      error: result.error,
      slots,
      prefs: {
        daysAhead: prefs.daysAhead,
        durationMinutes: prefs.durationMinutes,
        offerCount,
      },
      hint: slots.length
        ? `Offer up to ${offerCount} of these slots in natural speech. Do not invent other times.`
        : "No open slots found — say nothing is free in that window, ask for preferred days, or offer to follow up by SMS.",
    });
  } catch (err: any) {
    return JSON.stringify({
      connected: false,
      error: err?.message || "Availability check failed",
      slots: [],
      hint: "Apologize, say you cannot check the calendar right now, and ask them to try again later.",
    });
  }
}

async function bookAppointment(
  ctx: CallToolContext,
  args: Record<string, unknown>
): Promise<string> {
  if (!ctx.organizationId || !ctx.leadId) {
    return JSON.stringify({
      ok: false,
      error: "Missing organization or lead for booking",
      hint: "Apologize and ask them to try again later or confirm by SMS.",
    });
  }
  const scheduledAt = String(args.scheduledAt || "");
  const when = new Date(scheduledAt);
  if (Number.isNaN(when.getTime())) {
    return JSON.stringify({
      ok: false,
      error: "Invalid scheduledAt datetime",
      hint: "Ask the lead to confirm one of the offered slots again.",
    });
  }
  if (when.getTime() < Date.now() - 60_000) {
    return JSON.stringify({
      ok: false,
      error: "Cannot book a time in the past",
      hint: "Call check_availability again and book using an exact slots[].start ISO string.",
    });
  }
  if (ctx.midCallBooking) {
    return JSON.stringify({
      ok: true,
      alreadyBooked: true,
      appointmentId: ctx.midCallBooking.appointmentId,
      scheduledAt: ctx.midCallBooking.scheduledAt.toISOString(),
      hint: "Confirm the already-booked time verbally.",
    });
  }

  try {
    const prefs = await getCalendarBookingPrefs(ctx.organizationId);
    const result = await bookAppointmentWithCalendar({
      organizationId: ctx.organizationId,
      leadId: ctx.leadId,
      title: typeof args.title === "string" ? args.title : "Consultation",
      scheduledAt: when,
      durationMinutes:
        typeof args.durationMinutes === "number" ? args.durationMinutes : prefs.durationMinutes,
    });

    if (!result.synced) {
      return JSON.stringify({
        ok: false,
        appointmentId: result.appointmentId,
        syncedToCalendar: false,
        syncError: result.syncError,
        scheduledAt: when.toISOString(),
        hint:
          "Tell the lead booking failed on the calendar. Apologize, ask them to try again later. Do not say the meeting is confirmed.",
      });
    }

    ctx.setMidCallBooking({ scheduledAt: when, appointmentId: result.appointmentId });

    return JSON.stringify({
      ok: true,
      appointmentId: result.appointmentId,
      syncedToCalendar: true,
      scheduledAt: when.toISOString(),
      message: "Booked on CRM and calendar. Confirm the time verbally. Do not re-ask for name or phone.",
      hint: "Confirm booking in one short sentence using the CRM lead name on file unless they changed it.",
    });
  } catch (err: any) {
    return JSON.stringify({
      ok: false,
      error: err?.message || "Booking failed",
      hint: "Apologize, say booking failed, and ask them to try again later or follow up by SMS.",
    });
  }
}
