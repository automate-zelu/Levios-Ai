// ─── SDR STUCK ENROLLMENT RECOVERY ───────────────────────────────────────────
// Scans for enrollments stuck in non-terminal states beyond their expected
// threshold and advances them using planStuckRecovery() from sdr-m1-logic.
//
// Called by the Reactor on the same 30-minute schedule as the dormant lead scan.
// Event type: "sdr.recovery.scan"

import { db } from "./db.js";
import { sdrEnrollments, sdrConfigs, sdrLogs } from "./schema.js";
import type { EnrollmentStatus, SdrEnrollment } from "./schema.js";
import { planStuckRecovery } from "./sdr-m1-logic.js";
import { stateMachine } from "./sdr-state-machine.js";
import {
  enqueueJob,
  cancelJob,
  storeEnrollmentJobId,
} from "./sdr-queue.js";
import { eq, and, lt } from "drizzle-orm";
import { computeNextEnrollAfter } from "./sdr-eligibility.js";

// ─── THRESHOLDS ───────────────────────────────────────────────────────────────

const STUCK_THRESHOLDS: Partial<Record<EnrollmentStatus, number>> = {
  pending:         2  * 60 * 60 * 1000,
  re_enrolled:     2  * 60 * 60 * 1000,
  call_initiated:  4  * 60 * 60 * 1000,
  call_connected:  1  * 60 * 60 * 1000,
  call_busy:       1  * 60 * 60 * 1000,
  call_no_answer:  2  * 60 * 60 * 1000,
  call_failed:     2  * 60 * 60 * 1000,
  sms_sent:        25 * 60 * 60 * 1000,
  email_sent:      50 * 60 * 60 * 1000,
};

async function logRecoveryAction(
  enrollment: SdrEnrollment,
  action: string,
  payload: Record<string, unknown>
): Promise<void> {
  await db.insert(sdrLogs).values({
    workspaceId:  enrollment.workspaceId,
    enrollmentId: enrollment.id,
    leadId:       enrollment.leadId,
    step:         enrollment.currentStep,
    stepName:     "stuck_recovery",
    outcome:      action,
    payload,
    loggedAt:     new Date(),
  });
}

// ─── SINGLE ENROLLMENT RECOVERY ───────────────────────────────────────────────

export async function recoverEnrollment(enrollment: SdrEnrollment): Promise<{
  recovered: boolean;
  action: string;
}> {
  const status = enrollment.status as EnrollmentStatus;
  const now = new Date();
  const plan = planStuckRecovery(status, enrollment.callAttempts);

  if (!plan.recovered) {
    return { recovered: false, action: plan.action };
  }

  // Cancel any stale delayed job before replacing it
  if (enrollment.bullmqJobId) {
    try {
      await cancelJob(enrollment.bullmqJobId);
    } catch {
      // Job may already be gone — fine
    }
  }

  // Apply planned transitions (stateMachine writes its own audit log)
  for (const step of plan.transitions) {
    await stateMachine.transition(enrollment.id, step, {
      reason: "stuck_recovery",
      fromStatus: status,
      recoveredAt: now.toISOString(),
    });
  }

  // Enqueue follow-up job
  if (plan.enqueue) {
    const jobId = await enqueueJob(plan.enqueue, enrollment.id, 0);
    await storeEnrollmentJobId(enrollment.id, jobId);
  }

  // Schedule re-enrollment after exhaustion
  if (plan.scheduleReenroll) {
    const [config] = await db
      .select()
      .from(sdrConfigs)
      .where(eq(sdrConfigs.workspaceId, enrollment.workspaceId));

    if (config) {
      const reEnrollAt = computeNextEnrollAfter(config.reEnrollDays);
      await db
        .update(sdrEnrollments)
        .set({ nextEnrollAfter: reEnrollAt, updatedAt: new Date() })
        .where(eq(sdrEnrollments.id, enrollment.id));
    }
  }

  // Audit when we only re-queued (no stateMachine transition log)
  if (plan.transitions.length === 0) {
    await logRecoveryAction(enrollment, plan.action, {
      fromStatus: status,
      enqueue: plan.enqueue,
      recoveredAt: now.toISOString(),
    });
    await db
      .update(sdrEnrollments)
      .set({ updatedAt: now })
      .where(eq(sdrEnrollments.id, enrollment.id));
  }

  return { recovered: true, action: plan.action };
}

export async function recoverEnrollmentById(enrollmentId: string): Promise<{
  recovered: boolean;
  action: string;
  fromStatus?: string;
}> {
  const [enrollment] = await db
    .select()
    .from(sdrEnrollments)
    .where(eq(sdrEnrollments.id, enrollmentId));

  if (!enrollment) {
    throw new Error(`Enrollment ${enrollmentId} not found`);
  }

  const result = await recoverEnrollment(enrollment);
  return { ...result, fromStatus: enrollment.status };
}

// ─── SCHEDULED SCAN ───────────────────────────────────────────────────────────

export async function recoverStuckEnrollments(): Promise<{ recovered: number }> {
  let recovered = 0;
  const now = new Date();

  for (const [status, thresholdMs] of Object.entries(STUCK_THRESHOLDS)) {
    const stuckBefore = new Date(now.getTime() - thresholdMs);

    const stuckEnrollments = await db
      .select()
      .from(sdrEnrollments)
      .where(
        and(
          eq(sdrEnrollments.status, status),
          lt(sdrEnrollments.updatedAt, stuckBefore)
        )
      );

    for (const enrollment of stuckEnrollments) {
      try {
        const result = await recoverEnrollment(enrollment);
        if (result.recovered) {
          recovered++;
          console.log(
            `SDR Recovery: enrollment ${enrollment.id} (${enrollment.status} → ${result.action})`
          );
        }
      } catch (err: any) {
        console.error(
          `SDR Recovery: failed to recover enrollment ${enrollment.id}:`,
          err.message
        );
      }
    }
  }

  return { recovered };
}

// ─── ADMIN HELPER ─────────────────────────────────────────────────────────────

export async function listStuckEnrollments() {
  const now = new Date();

  const results: Array<{
    enrollmentId: string;
    workspaceId:  string;
    leadId:       number;
    status:       string;
    stuckSince:   Date;
    ageHours:     number;
    callAttempts: number;
  }> = [];

  for (const [status, thresholdMs] of Object.entries(STUCK_THRESHOLDS)) {
    const stuckBefore = new Date(now.getTime() - thresholdMs);

    const rows = await db
      .select()
      .from(sdrEnrollments)
      .where(
        and(
          eq(sdrEnrollments.status, status),
          lt(sdrEnrollments.updatedAt, stuckBefore)
        )
      );

    for (const row of rows) {
      results.push({
        enrollmentId: row.id,
        workspaceId:  row.workspaceId,
        leadId:       row.leadId,
        status:       row.status,
        stuckSince:   row.updatedAt,
        ageHours:     Math.round((now.getTime() - row.updatedAt.getTime()) / 3_600_000),
        callAttempts: row.callAttempts,
      });
    }
  }

  return results;
}
