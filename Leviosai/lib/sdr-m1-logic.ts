// ─── SDR M1 PURE DECISION HELPERS ────────────────────────────────────────────
// Side-effect-free planners used by the queue, orchestrator, and recovery.
// Unit-tested without DB / Redis.

import type { EnrollmentStatus } from "./schema.js";
import {
  MAX_CALL_ATTEMPTS,
  SMS_READY_STATUSES,
  TERMINAL_STATUSES,
  stateMachine,
} from "./sdr-state-machine.js";
import { isMinuteLimitReached as tierMinuteLimitReached } from "./tiers.js";

// ─── BUSY RETRY ───────────────────────────────────────────────────────────────

/** True while dial attempts remain under the max (initial + 2 busy retries). */
export function shouldRetryBusyCall(callAttempts: number): boolean {
  return callAttempts < MAX_CALL_ATTEMPTS;
}

// ─── MINUTE LIMIT ─────────────────────────────────────────────────────────────

/** True when the workspace has exhausted its monthly calling minutes. */
export function isMinuteLimitReached(minutesUsed: number, minuteLimit: number): boolean {
  return tierMinuteLimitReached(minutesUsed, minuteLimit);
}

/**
 * Billable calling time for usage metering — same second-level counting as
 * in-browser test calls.
 * Unanswered / busy / failed dials do NOT count — even if Twilio reports a few
 * seconds of ring time. Only answered conversations (incl. booked / qualified /
 * voicemail) are billed. Tiny completed blips with no conversation stay free.
 */
export function billableCallSeconds(
  durationSeconds: number,
  opts: { callStatus?: string | null; outcome?: string | null } = {}
): number {
  const status = (opts.callStatus || "").toLowerCase();
  const outcome = (opts.outcome || "").toLowerCase();

  if (status === "no-answer" || status === "busy" || status === "failed") return 0;
  if (outcome === "no_answer" || outcome === "busy" || outcome === "failed") return 0;

  const secs = Math.max(0, Math.floor(Number(durationSeconds) || 0));
  if (secs <= 0) return 0;

  const answered =
    outcome === "answered" ||
    outcome === "qualified" ||
    outcome === "booked" ||
    outcome === "voicemail";

  // Twilio sometimes reports CallStatus=completed with a 1–2s duration for
  // carrier blips / immediate hangups with no conversation outcome.
  if (!answered && secs < 15) return 0;

  return secs;
}

/** Fractional minutes (seconds / 60) stored on the workspace usage counter. */
export function billableCallMinutes(
  durationSeconds: number,
  opts: { callStatus?: string | null; outcome?: string | null } = {}
): number {
  return billableCallSeconds(durationSeconds, opts) / 60;
}

// ─── SMS FALL-THROUGH PLAN ────────────────────────────────────────────────────

export type SmsFallthroughPlan =
  | { kind: "skip"; reason: string }
  | { kind: "sms_ready" }                         // already legal to SEND_SMS
  | { kind: "advance"; steps: EnrollmentStatus[] }; // transition these, then SEND_SMS

/**
 * Decide how to move an enrollment into an SMS-ready state before enqueueing SEND_SMS.
 * Mirrors fallThroughToSms() without touching the DB.
 */
export function planSmsFallthrough(status: EnrollmentStatus): SmsFallthroughPlan {
  if (
    TERMINAL_STATUSES.includes(status) ||
    status === "sms_sent" ||
    status === "sms_replied" ||
    status === "email_sent" ||
    status === "email_replied"
  ) {
    return { kind: "skip", reason: `already_past_call_step:${status}` };
  }

  if (status === "pending" || status === "re_enrolled") {
    return { kind: "advance", steps: ["call_initiated", "call_no_answer"] };
  }

  if (status === "call_initiated" || status === "call_connected") {
    return { kind: "advance", steps: ["call_no_answer"] };
  }

  if (SMS_READY_STATUSES.includes(status)) {
    return { kind: "sms_ready" };
  }

  return { kind: "skip", reason: `unexpected_status:${status}` };
}

/** Validate that every step in a fall-through plan is a legal transition chain. */
export function assertFallthroughChainLegal(
  fromStatus: EnrollmentStatus,
  plan: SmsFallthroughPlan
): boolean {
  if (plan.kind !== "advance") return true;
  let current = fromStatus;
  for (const next of plan.steps) {
    if (!stateMachine.canTransition(current, next)) return false;
    current = next;
  }
  // After advances, SEND_SMS → sms_sent must be legal
  return stateMachine.canTransition(current, "sms_sent");
}

// ─── STUCK RECOVERY PLAN ──────────────────────────────────────────────────────

export type RecoveryAction =
  | "requeued_initiate_call"
  | "call_no_answer_then_sms"
  | "requeued_busy_retry"
  | "busy_fallthrough_sms"
  | "requeued_send_sms"
  | "requeued_send_email"
  | "exhausted_with_reenroll"
  | "terminal_skip"
  | `unsupported_status:${string}`;

export interface StuckRecoveryPlan {
  recovered: boolean;
  action: RecoveryAction;
  /** State transitions to apply before enqueueing (empty = enqueue only). */
  transitions: EnrollmentStatus[];
  /** Job to enqueue after transitions (null = none). */
  enqueue: "INITIATE_CALL" | "SEND_SMS" | "SEND_EMAIL" | null;
  /** When true, set nextEnrollAfter from config after exhausting. */
  scheduleReenroll: boolean;
}

/**
 * Decide recovery action for a stuck enrollment.
 * Mirrors recoverEnrollment() without touching the DB / queue.
 */
export function planStuckRecovery(
  status: EnrollmentStatus,
  callAttempts: number
): StuckRecoveryPlan {
  if (TERMINAL_STATUSES.includes(status)) {
    return {
      recovered: false,
      action: "terminal_skip",
      transitions: [],
      enqueue: null,
      scheduleReenroll: false,
    };
  }

  switch (status) {
    case "pending":
    case "re_enrolled":
      return {
        recovered: true,
        action: "requeued_initiate_call",
        transitions: [], // initiateCall owns call_initiated
        enqueue: "INITIATE_CALL",
        scheduleReenroll: false,
      };

    case "call_initiated":
    case "call_connected":
      return {
        recovered: true,
        action: "call_no_answer_then_sms",
        transitions: ["call_no_answer"],
        enqueue: "SEND_SMS",
        scheduleReenroll: false,
      };

    case "call_busy":
      if (shouldRetryBusyCall(callAttempts)) {
        return {
          recovered: true,
          action: "requeued_busy_retry",
          transitions: [],
          enqueue: "INITIATE_CALL",
          scheduleReenroll: false,
        };
      }
      return {
        recovered: true,
        action: "busy_fallthrough_sms",
        transitions: [], // already SMS-ready
        enqueue: "SEND_SMS",
        scheduleReenroll: false,
      };

    case "call_no_answer":
    case "call_failed":
      return {
        recovered: true,
        action: "requeued_send_sms",
        transitions: [],
        enqueue: "SEND_SMS",
        scheduleReenroll: false,
      };

    case "sms_sent":
      return {
        recovered: true,
        action: "requeued_send_email",
        transitions: [], // SEND_EMAIL owns email_sent — do NOT pre-transition
        enqueue: "SEND_EMAIL",
        scheduleReenroll: false,
      };

    case "email_sent":
      return {
        recovered: true,
        action: "exhausted_with_reenroll",
        transitions: ["exhausted"],
        enqueue: null,
        scheduleReenroll: true,
      };

    default:
      return {
        recovered: false,
        action: `unsupported_status:${status}`,
        transitions: [],
        enqueue: null,
        scheduleReenroll: false,
      };
  }
}

/** Validate recovery transition chain is legal from the stuck status. */
export function assertRecoveryChainLegal(
  fromStatus: EnrollmentStatus,
  plan: StuckRecoveryPlan
): boolean {
  let current = fromStatus;
  for (const next of plan.transitions) {
    if (!stateMachine.canTransition(current, next)) return false;
    current = next;
  }
  if (plan.enqueue === "SEND_SMS") {
    return SMS_READY_STATUSES.includes(current) || stateMachine.canTransition(current, "sms_sent");
  }
  if (plan.enqueue === "SEND_EMAIL") {
    // Must still be sms_sent — never pre-advanced to email_sent
    return current === "sms_sent";
  }
  if (plan.enqueue === "INITIATE_CALL") {
    // pending/re_enrolled/call_busy may dial
    return (
      current === "pending" ||
      current === "re_enrolled" ||
      current === "call_busy" ||
      current === "call_initiated"
    );
  }
  return true;
}
