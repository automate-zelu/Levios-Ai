/**
 * SMS follow-up reply mapping — intent, slot offers, booking confirmations.
 * Run: npx tsx --test tests/sdr-sms-followup.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyIntentHeuristic,
  parseLooseAppointmentTime,
  mapFollowupScheduleReply,
  wantsSchedulingHelp,
} from "../lib/sdr-followup-reply.js";
import {
  DEFAULT_CALENDAR_BOOKING_PREFS,
} from "../lib/calendar/booking-helpers.js";
import { workingHoursFallbackSlots } from "../lib/calendar/service.js";

describe("SMS intent mapping", () => {
  it("maps agreement phrases to agree", () => {
    for (const t of ["Yes", "YES", "yeah", "sounds good", "I'd love to", "let's do it"]) {
      assert.equal(classifyIntentHeuristic(t), "agree", t);
      assert.equal(wantsSchedulingHelp(t, "agree"), true, t);
    }
  });

  it("maps opt-out / decline to disagree", () => {
    for (const t of ["no thanks", "not interested", "stop", "unsubscribe"]) {
      assert.equal(classifyIntentHeuristic(t), "disagree", t);
    }
  });

  it("maps questions to question", () => {
    assert.equal(classifyIntentHeuristic("what is this about?"), "question");
    assert.equal(classifyIntentHeuristic("when are you available"), "question");
  });
});

describe("parseLooseAppointmentTime", () => {
  const now = new Date("2026-08-17T14:00:00.000Z"); // Mon afternoon UTC

  it("returns null for Yes / vague interest", () => {
    assert.equal(parseLooseAppointmentTime("Yes", now), null);
    assert.equal(parseLooseAppointmentTime("sounds good", now), null);
  });

  it("parses tomorrow at 3pm in America/New_York", () => {
    const d = parseLooseAppointmentTime("tomorrow at 3pm", now, "America/New_York");
    assert.ok(d);
    assert.ok(d.getTime() > now.getTime());
    const label = d.toLocaleString("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "numeric",
      hour12: true,
    });
    assert.match(label, /Tue/);
    assert.match(label, /3\s*PM/i);
  });

  it("parses weekday + clock", () => {
    const d = parseLooseAppointmentTime("Thursday 10:30 am", now, "America/New_York");
    assert.ok(d);
    const label = d.toLocaleString("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    assert.match(label, /Thu/);
    assert.match(label, /10:30\s*AM/i);
  });
});

describe("mapFollowupScheduleReply — SMS responses", () => {
  const base = {
    channel: "sms" as const,
    firstName: "Mohammed",
    companyName: "Levios Demo",
    draftReply: "Awesome, Mohammed! What days work?",
    inboundText: "Yes",
    intent: "agree" as const,
    extractedAt: null as Date | null,
    bookResult: null,
  };

  it("Yes + Google API error with fallback slots → offers times (not trouble reading)", () => {
    const mapped = mapFollowupScheduleReply({
      ...base,
      availability: {
        connected: true,
        error: "Google Calendar API is disabled",
        slots: [
          { start: "2026-08-18T15:00:00.000Z", end: "2026-08-18T15:30:00.000Z", label: "Tue, Aug 18, 11:00 AM – 11:30 AM" },
          { start: "2026-08-18T16:00:00.000Z", end: "2026-08-18T16:30:00.000Z", label: "Tue, Aug 18, 12:00 PM – 12:30 PM" },
          { start: "2026-08-18T17:00:00.000Z", end: "2026-08-18T17:30:00.000Z", label: "Tue, Aug 18, 1:00 PM – 1:30 PM" },
        ],
        prefs: { offerCount: 3, daysAhead: 5 },
      },
    });
    assert.equal(mapped.bookedAppt, false);
    assert.match(mapped.reply, /Open times:/);
    assert.match(mapped.reply, /Tue, Aug 18/);
    assert.doesNotMatch(mapped.reply, /trouble reading/i);
    assert.doesNotMatch(mapped.reply, /Google Cloud/i);
  });

  it("concrete time + CRM appointment even if Google sync fails → booked", () => {
    const when = new Date("2026-08-18T15:00:00.000Z");
    const mapped = mapFollowupScheduleReply({
      ...base,
      inboundText: "Tue 3pm",
      extractedAt: when,
      bookResult: { appointmentId: 99, synced: false, syncError: "API disabled" },
      availability: null,
      timezone: "America/New_York",
    });
    assert.equal(mapped.bookedAppt, true);
    assert.match(mapped.reply, /You're booked, Mohammed/i);
    assert.match(mapped.reply, /11:00 AM/i);
    assert.match(mapped.reply, /sync Google Calendar shortly/i);
    assert.doesNotMatch(mapped.reply, /couldn't lock/i);
  });

  it("disagree does not offer calendar slots", () => {
    const mapped = mapFollowupScheduleReply({
      ...base,
      intent: "disagree",
      inboundText: "not interested",
      draftReply: "No worries at all, Mohammed — thanks for letting me know.",
      availability: {
        connected: true,
        slots: [{ start: "x", end: "y", label: "Tue 11am" }],
      },
    });
    assert.equal(mapped.bookedAppt, false);
    assert.equal(mapped.reply, "No worries at all, Mohammed — thanks for letting me know.");
  });

  it("no slots and no error → says calendar is full", () => {
    const mapped = mapFollowupScheduleReply({
      ...base,
      availability: { connected: true, slots: [], prefs: { daysAhead: 5, offerCount: 3 } },
    });
    assert.match(mapped.reply, /don't have open slots/i);
  });
});

describe("workingHoursFallbackSlots", () => {
  it("returns weekday business-hour slots from prefs", () => {
    const slots = workingHoursFallbackSlots(
      { ...DEFAULT_CALENDAR_BOOKING_PREFS, offerCount: 3, maxSlots: 6 },
      new Date("2030-01-07T14:00:00.000Z")
    );
    assert.ok(slots.length >= 3);
    assert.ok(slots.every((s) => s.label && s.start && s.end));
  });
});
