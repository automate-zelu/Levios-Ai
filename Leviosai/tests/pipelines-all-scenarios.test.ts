/**
 * Offline tests for every SDR pipeline / scenario.
 * No Twilio, Gmail, ElevenLabs, or live HTTP — pure decision helpers only.
 *
 *   npm run test:pipelines
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stateMachine } from "../lib/sdr-state-machine.js";
import type { EnrollmentStatus } from "../lib/schema.js";
import {
  planSmsFallthrough,
  shouldRetryBusyCall,
  billableCallMinutes,
} from "../lib/sdr-m1-logic.js";
import { evaluateEnrollmentEligibility } from "../lib/sdr-eligibility.js";
import {
  transcriptHasLeadSpeech,
  resolvePostCallOutcome,
  resolveTwilioHangupAction,
} from "../lib/calling/pipeline-helpers.js";
import {
  classifyIntentHeuristic,
  mapFollowupScheduleReply,
  parseLooseAppointmentTime,
  wantsSchedulingHelp,
} from "../lib/sdr-followup-reply.js";
import { isFrequencyLimitReached, evaluateQuietHours } from "../lib/compliance.js";
import { workingHoursFallbackSlots } from "../lib/calendar/service.js";
import { DEFAULT_CALENDAR_BOOKING_PREFS } from "../lib/calendar/booking-helpers.js";

function chain(steps: EnrollmentStatus[]) {
  for (let i = 0; i < steps.length - 1; i++) {
    assert.equal(
      stateMachine.canTransition(steps[i], steps[i + 1]),
      true,
      `${steps[i]} → ${steps[i + 1]}`
    );
  }
}

describe("Voice hangup pipeline (no live call)", () => {
  it("Twilio no-answer / failed / canceled → SMS miss path", () => {
    assert.equal(resolveTwilioHangupAction({ callStatus: "no-answer" }), "sms_miss");
    assert.equal(resolveTwilioHangupAction({ callStatus: "failed" }), "sms_failed");
    assert.equal(resolveTwilioHangupAction({ callStatus: "canceled" }), "sms_failed");
    assert.equal(planSmsFallthrough("call_initiated").kind, "advance");
    assert.equal(planSmsFallthrough("call_connected").kind, "advance");
  });

  it("busy retries then SMS", () => {
    assert.equal(shouldRetryBusyCall(1), true);
    assert.equal(shouldRetryBusyCall(2), true);
    assert.equal(shouldRetryBusyCall(3), false);
    assert.equal(resolveTwilioHangupAction({ callStatus: "busy", callAttempts: 1 }), "busy_retry");
    assert.equal(resolveTwilioHangupAction({ callStatus: "busy", callAttempts: 3 }), "sms_busy_max");
  });

  it("voicemail / greeting-only completed call is a miss, not answered", () => {
    const greetingOnly = "AI: Hi, this is Aria calling from NorthPeak HVAC.";
    assert.equal(transcriptHasLeadSpeech(greetingOnly), false);
    assert.equal(
      resolvePostCallOutcome({ transcript: greetingOnly, analysedOutcome: "answered" }),
      "no_answer"
    );
    assert.equal(
      resolvePostCallOutcome({
        transcript: greetingOnly,
        analysedOutcome: "answered",
        callConnected: true,
      }),
      "no_response"
    );
    assert.equal(
      resolveTwilioHangupAction({
        callStatus: "completed",
        outcome: "answered",
        transcript: greetingOnly,
        callConnected: true,
      }),
      "sms_miss"
    );
  });

  it("human speech + booked outcome → booked (no SMS)", () => {
    const t = "AI: Hi Aria here.\nLEAD: Tuesday at 3 works.\nAI: Booked.";
    assert.equal(transcriptHasLeadSpeech(t), true);
    assert.equal(
      resolveTwilioHangupAction({ callStatus: "completed", outcome: "booked", transcript: t }),
      "booked"
    );
    assert.equal(
      resolvePostCallOutcome({ transcript: t, analysedOutcome: "answered", midCallBooking: true }),
      "booked"
    );
  });

  it("human speech without booking → answered_exhausted", () => {
    const t = "AI: Hi.\nLEAD: Just calling to say not now.\nAI: Understood.";
    assert.equal(
      resolveTwilioHangupAction({ callStatus: "completed", outcome: "answered", transcript: t }),
      "answered_exhausted"
    );
  });

  it("does not bill unanswered blips; bills answered minutes", () => {
    assert.equal(billableCallMinutes(8, { callStatus: "completed", outcome: "no_answer" }), 0);
    assert.equal(billableCallMinutes(65, { callStatus: "completed", outcome: "answered" }), 65 / 60);
    assert.equal(billableCallMinutes(12, { callStatus: "no-answer" }), 0);
  });
});

describe("Sequence maps (no enroll / no Twilio)", () => {
  it("miss → SMS → email → exhausted", () => {
    chain(["pending", "call_initiated", "call_no_answer", "sms_sent", "email_sent", "exhausted"]);
  });

  it("SMS reply → booked", () => {
    chain(["sms_sent", "sms_replied", "booked"]);
  });

  it("email reply → booked", () => {
    chain(["email_sent", "email_replied", "booked"]);
  });

  it("answer → booked (no SMS/email)", () => {
    chain(["pending", "call_initiated", "call_connected", "call_answered", "booked"]);
    assert.equal(stateMachine.canTransition("booked", "sms_sent"), false);
    assert.equal(stateMachine.canTransition("booked", "email_sent"), false);
  });
});

describe("Enroll gates (no CRM writes)", () => {
  const ws = { isActive: true, monthlyLeadsUsed: 1, monthlyLeadLimit: 500 };
  const lead = { status: "new", consentStatus: "opted_in", dncClean: true, lastContactedAt: null };

  it("blocks booked and active cycles", () => {
    assert.equal(
      evaluateEnrollmentEligibility({
        lead,
        workspace: ws,
        requireDormant: false,
        latestEnrollment: { id: "a", status: "booked" },
      }).ok,
      false
    );
    const active = evaluateEnrollmentEligibility({
      lead,
      workspace: ws,
      requireDormant: false,
      latestEnrollment: { id: "a", status: "sms_sent" },
    });
    assert.equal(active.ok, false);
    if (!active.ok) assert.equal(active.reason, "active_enrollment");
  });

  it("allows reenroll after exhausted when gate is open", () => {
    const d = evaluateEnrollmentEligibility({
      lead,
      workspace: ws,
      requireDormant: false,
      latestEnrollment: { id: "a", status: "exhausted", nextEnrollAfter: null },
    });
    assert.deepEqual(d, { ok: true, mode: "reenroll", enrollmentId: "a" });
  });

  it("blocks DNC / opt-out / inactive workspace", () => {
    assert.equal(
      evaluateEnrollmentEligibility({ lead: { ...lead, dncClean: false }, workspace: ws, requireDormant: false }).ok,
      false
    );
    assert.equal(
      evaluateEnrollmentEligibility({
        lead: { ...lead, consentStatus: "opted_out" },
        workspace: ws,
        requireDormant: false,
      }).ok,
      false
    );
    assert.equal(
      evaluateEnrollmentEligibility({ lead, workspace: { ...ws, isActive: false }, requireDormant: false }).ok,
      false
    );
  });

  it("weekly frequency cap at 3", () => {
    assert.equal(isFrequencyLimitReached(2), false);
    assert.equal(isFrequencyLimitReached(3), true);
  });
});

const slots = [
  { start: "2026-08-18T13:00:00.000Z", end: "2026-08-18T13:30:00.000Z", label: "Tue, Aug 18, 9:00 AM – 9:30 AM" },
  { start: "2026-08-18T13:30:00.000Z", end: "2026-08-18T14:00:00.000Z", label: "Tue, Aug 18, 9:30 AM – 10:00 AM" },
  { start: "2026-08-18T14:00:00.000Z", end: "2026-08-18T14:30:00.000Z", label: "Tue, Aug 18, 10:00 AM – 10:30 AM" },
];

describe("SMS conversation matrix (no Twilio send)", () => {
  const smsBase = {
    channel: "sms" as const,
    firstName: "Mohammed",
    companyName: "Levios Demo",
    draftReply: "Thanks Mohammed",
    extractedAt: null as Date | null,
    bookResult: null,
  };

  const cases: Array<{ name: string; inbound: string; intent: "agree" | "disagree" | "question" | "other"; check: (r: string, booked: boolean) => void }> = [
    {
      name: "YES → offer slots, never 'trouble reading'",
      inbound: "Yes",
      intent: "agree",
      check: (r, booked) => {
        assert.equal(booked, false);
        assert.match(r, /Open times:/);
        assert.doesNotMatch(r, /trouble reading/i);
      },
    },
    {
      name: "opt-out → no slots",
      inbound: "stop",
      intent: "disagree",
      check: (r, booked) => {
        assert.equal(booked, false);
        assert.equal(r, "Thanks Mohammed");
      },
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      assert.equal(classifyIntentHeuristic(c.inbound), c.intent);
      const mapped = mapFollowupScheduleReply({
        ...smsBase,
        inboundText: c.inbound,
        intent: c.intent,
        availability: { connected: true, error: "Google disabled", slots, prefs: { offerCount: 3 } },
      });
      c.check(mapped.reply, mapped.bookedAppt);
    });
  }

  it("named time books even if Google sync fails", () => {
    const when = new Date("2026-08-18T14:00:00.000Z"); // 10:00 AM ET
    const mapped = mapFollowupScheduleReply({
      ...smsBase,
      inboundText: "Tuesday 10am",
      intent: "agree",
      extractedAt: when,
      bookResult: { appointmentId: 1, synced: false, syncError: "api" },
      availability: null,
      timezone: "America/New_York",
    });
    assert.equal(mapped.bookedAppt, true);
    assert.match(mapped.reply, /10:00 AM/);
    assert.match(mapped.reply, /You're booked/);
  });

  it("parseLooseAppointmentTime ignores Yes", () => {
    assert.equal(parseLooseAppointmentTime("Yes"), null);
    assert.ok(parseLooseAppointmentTime("Tuesday 10:00 am", new Date("2026-08-15T12:00:00Z")));
  });
});

describe("Email conversation matrix (no Gmail send)", () => {
  const emailBase = {
    channel: "email" as const,
    firstName: "Mohammed",
    companyName: "Levios Demo",
    draftReply: "Hi Mohammed, thanks for writing.",
    extractedAt: null as Date | null,
    bookResult: null,
  };

  it("question does not force calendar slots", () => {
    const intent = classifyIntentHeuristic("what is this email about?");
    assert.equal(intent, "question");
    assert.equal(wantsSchedulingHelp("what is this email about?", intent), false);
    const mapped = mapFollowupScheduleReply({
      ...emailBase,
      inboundText: "what is this email about?",
      intent,
      availability: { connected: true, slots },
    });
    assert.equal(mapped.reply, emailBase.draftReply);
    assert.equal(mapped.bookedAppt, false);
  });

  it("agree + times → bullet slot list", () => {
    const mapped = mapFollowupScheduleReply({
      ...emailBase,
      inboundText: "Yes, what times do you have this week?",
      intent: "agree",
      availability: { connected: true, slots, prefs: { offerCount: 3 } },
    });
    assert.match(mapped.reply, /Here are open times/);
    assert.match(mapped.reply, /Tue, Aug 18, 9:00 AM/);
    assert.doesNotMatch(mapped.reply, /trouble reading/i);
  });

  it("Tuesday 10am books with Eastern label", () => {
    const when = new Date("2026-08-18T14:00:00.000Z");
    const mapped = mapFollowupScheduleReply({
      ...emailBase,
      inboundText: "Tuesday 10:00 am works for me.",
      intent: "agree",
      extractedAt: when,
      bookResult: { appointmentId: 7, synced: true },
      availability: null,
      timezone: "America/New_York",
    });
    assert.equal(mapped.bookedAppt, true);
    assert.equal(mapped.calendarSynced, true);
    assert.match(mapped.reply, /You're confirmed for Tue, Aug 18, 10:00 AM/);
  });

  it("decline stays gracious and does not book", () => {
    const mapped = mapFollowupScheduleReply({
      ...emailBase,
      inboundText: "not interested",
      intent: "disagree",
      draftReply: "Hi Mohammed,\n\nTotally understand.",
      availability: { connected: true, slots },
    });
    assert.equal(mapped.bookedAppt, false);
    assert.match(mapped.reply, /Totally understand/);
  });
});

describe("Calendar fallback slots (no Google API)", () => {
  it("builds weekday working-hour offers", () => {
    const slots = workingHoursFallbackSlots(
      DEFAULT_CALENDAR_BOOKING_PREFS,
      new Date("2030-01-07T14:00:00.000Z")
    );
    assert.ok(slots.length >= 3);
  });
});

describe("Quiet hours (no dial)", () => {
  it("blocks late local evening", () => {
    const blocked = evaluateQuietHours(
      { phone: "2125550100", timezone: "America/New_York" },
      new Date("2026-08-15T03:00:00.000Z") // 11pm ET
    );
    assert.equal(blocked.allowed, false);
  });
});
