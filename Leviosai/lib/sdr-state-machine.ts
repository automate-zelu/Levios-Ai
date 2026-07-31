// ─── SDR SEQUENCE STATE MACHINE ──────────────────────────────────────────────
// Replaces n8n as the sequence engine. Pure TypeScript — persists state to
// Postgres, writes an audit log entry on every transition.
// Invalid transitions are rejected with an error — the machine never allows
// an enrollment to skip or reverse states.

import { db } from "./db.js";
import { sdrEnrollments, sdrLogs } from "./schema.js";
import type { EnrollmentStatus } from "./schema.js";
import { eq } from "drizzle-orm";

// ─── CALL ATTEMPT LIMITS ─────────────────────────────────────────────────────
// Initial dial + up to 2 busy retries = 3 attempts total (plan §2 Step 4C).
export const MAX_CALL_ATTEMPTS = 3;
export const BUSY_RETRY_DELAY_MS = 30 * 60 * 1000; // 30 minutes

// ─── VALID STATE TRANSITIONS ─────────────────────────────────────────────────
// Map of: current state → allowed next states.
// Any transition not in this map is rejected.
// `exhausted` is reachable from active states so opt-out / compliance can halt mid-sequence.

export const TRANSITIONS: Record<EnrollmentStatus, EnrollmentStatus[]> = {
  pending:        ["call_initiated", "exhausted"],
  call_initiated: ["call_connected", "call_no_answer", "call_busy", "call_failed", "exhausted"],
  call_connected: ["call_answered", "call_no_answer", "exhausted"],
  call_answered:  ["booked", "exhausted"],
  call_no_answer: ["sms_sent"],
  call_busy:      ["call_initiated", "sms_sent", "exhausted"],  // retry dial or fall to SMS
  call_failed:    ["sms_sent", "exhausted"],
  sms_sent:       ["sms_replied", "email_sent", "exhausted"],
  sms_replied:    ["booked", "exhausted"],
  email_sent:     ["email_replied", "exhausted"],
  email_replied:  ["booked", "exhausted"],
  booked:         [],                              // terminal — sequence complete
  exhausted:      ["re_enrolled"],
  re_enrolled:    ["call_initiated", "exhausted"],
};

/** Statuses where the sequence is finished (no further outbound steps). */
export const TERMINAL_STATUSES: EnrollmentStatus[] = ["booked", "exhausted"];

/** Statuses from which SEND_SMS may legally transition to sms_sent. */
export const SMS_READY_STATUSES: EnrollmentStatus[] = [
  "call_no_answer",
  "call_busy",
  "call_failed",
];

// ─── STATE MACHINE CLASS ──────────────────────────────────────────────────────

export class SDRStateMachine {
  /**
   * Transition an enrollment to a new status.
   * Validates the transition is allowed, persists the new state,
   * and writes an audit log entry.
   */
  async transition(
    enrollmentId: string,
    toStatus: EnrollmentStatus,
    payload?: Record<string, unknown>
  ): Promise<void> {
    // Load current enrollment
    const [enrollment] = await db
      .select()
      .from(sdrEnrollments)
      .where(eq(sdrEnrollments.id, enrollmentId));

    if (!enrollment) {
      throw new Error(`Enrollment ${enrollmentId} not found`);
    }

    const currentStatus = enrollment.status as EnrollmentStatus;
    const allowed = TRANSITIONS[currentStatus];

    if (!allowed?.includes(toStatus)) {
      throw new Error(
        `Invalid SDR transition: ${currentStatus} → ${toStatus} for enrollment ${enrollmentId}`
      );
    }

    // Build timestamp updates based on the new state
    const timestampUpdates: Record<string, Date> = {};
    if (toStatus === "call_initiated") timestampUpdates.callInitiatedAt = new Date();
    if (toStatus === "sms_sent")       timestampUpdates.smsSentAt       = new Date();
    if (toStatus === "email_sent")     timestampUpdates.emailSentAt     = new Date();
    if (toStatus === "exhausted")      timestampUpdates.exhaustedAt     = new Date();

    // Persist new state
    await db
      .update(sdrEnrollments)
      .set({ status: toStatus, updatedAt: new Date(), ...timestampUpdates })
      .where(eq(sdrEnrollments.id, enrollmentId));

    // Write audit log entry
    await db.insert(sdrLogs).values({
      workspaceId:  enrollment.workspaceId,
      enrollmentId: enrollment.id,
      leadId:       enrollment.leadId,
      step:         enrollment.currentStep,
      stepName:     toStatus,
      outcome:      toStatus,
      payload:      payload ?? {},
      loggedAt:     new Date(),
    });
  }

  /**
   * Check whether a transition is valid without executing it.
   */
  canTransition(fromStatus: EnrollmentStatus, toStatus: EnrollmentStatus): boolean {
    return TRANSITIONS[fromStatus]?.includes(toStatus) ?? false;
  }
}

// Singleton — one state machine instance shared across the process
export const stateMachine = new SDRStateMachine();
