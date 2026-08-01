// ─── Start a fresh SDR enrollment cycle ─────────────────────────────────────
// Re-enrollment always creates a NEW enrollment row so each dial/sequence has
// its own clean log history. The previous exhausted enrollment stays closed.

import { db } from "./db.js";
import { sdrEnrollments } from "./schema.js";
import { enqueueJob, storeEnrollmentJobId } from "./sdr-queue.js";

export async function startFreshEnrollment(opts: {
  workspaceId: string;
  leadId: number;
  /** Prior exhausted enrollment id (audit only) */
  priorEnrollmentId?: string | null;
  reason?: string;
}): Promise<{ enrollment: typeof sdrEnrollments.$inferSelect; jobId: string | null }> {
  const [enrollment] = await db
    .insert(sdrEnrollments)
    .values({
      workspaceId: opts.workspaceId,
      leadId: opts.leadId,
      status: "pending",
      currentStep: 1,
      callAttempts: 0,
      nextEnrollAfter: null,
    })
    .returning();

  const jobId = await enqueueJob("INITIATE_CALL", enrollment.id);
  if (jobId) await storeEnrollmentJobId(enrollment.id, jobId);

  return { enrollment, jobId };
}
