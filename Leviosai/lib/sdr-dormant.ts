// ─── SDR DORMANT LEAD SCANNER ────────────────────────────────────────────────
// Called by the Reactor dormantLeadAgent every 30 minutes.
// Scans all active workspaces, finds leads past their dormant_days threshold,
// and enrolls eligible leads into the SDR sequence (fresh or re-enroll).
//
// Eligibility is centralized in lib/sdr-eligibility.ts (Module 7).

import { db } from "./db.js";
import { sdrConfigs, sdrEnrollments, workspaces, leads } from "./schema.js";
import { enqueueJob } from "./sdr-queue.js";
import { stateMachine } from "./sdr-state-machine.js";
import {
  evaluateEnrollmentEligibility,
  wouldExceedLeadLimitAfter,
  SKIP_LEAD_STATUSES,
} from "./sdr-eligibility.js";
import { eq, and, lt, or, isNull, notInArray, sql, desc } from "drizzle-orm";

export type ScanDormantResult = {
  enrolled: number;
  reenrolled: number;
  skipped: number;
  workspacesScanned: number;
  workspacesSkippedLimit: number;
};

async function getLatestEnrollment(workspaceId: string, leadId: number) {
  const [row] = await db
    .select({
      id: sdrEnrollments.id,
      status: sdrEnrollments.status,
      nextEnrollAfter: sdrEnrollments.nextEnrollAfter,
    })
    .from(sdrEnrollments)
    .where(
      and(
        eq(sdrEnrollments.leadId, leadId),
        eq(sdrEnrollments.workspaceId, workspaceId)
      )
    )
    .orderBy(desc(sdrEnrollments.enrolledAt))
    .limit(1);
  return row ?? null;
}

async function incrementLeadUsage(workspaceId: string) {
  await db
    .update(workspaces)
    .set({
      monthlyLeadsUsed: sql`${workspaces.monthlyLeadsUsed} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(workspaces.id, workspaceId));
}

async function attachJob(enrollmentId: string, jobId: string | null) {
  if (!jobId) return;
  await db
    .update(sdrEnrollments)
    .set({ bullmqJobId: jobId, updatedAt: new Date() })
    .where(eq(sdrEnrollments.id, enrollmentId));
}

export async function scanDormantLeads(): Promise<ScanDormantResult> {
  let enrolled = 0;
  let reenrolled = 0;
  let skipped = 0;
  let workspacesScanned = 0;
  let workspacesSkippedLimit = 0;

  const activeConfigs = await db
    .select()
    .from(sdrConfigs)
    .where(eq(sdrConfigs.isActive, true));

  for (const config of activeConfigs) {
    workspacesScanned++;
    let enrolledThisWorkspace = 0;

    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, config.workspaceId));

    if (!workspace || !workspace.isActive) {
      skipped++;
      continue;
    }

    // Tier-limit skip — entire workspace (validated + counted for ops)
    if (
      wouldExceedLeadLimitAfter(
        workspace.monthlyLeadsUsed,
        workspace.monthlyLeadLimit,
        0
      )
    ) {
      workspacesSkippedLimit++;
      console.log(
        `SDR Scan: workspace ${workspace.id} at lead limit (${workspace.monthlyLeadsUsed}/${workspace.monthlyLeadLimit}) — skipping`
      );
      continue;
    }

    const dormantCutoff = new Date();
    dormantCutoff.setDate(dormantCutoff.getDate() - config.dormantDays);

    const dormantLeads = await db
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.organizationId, workspace.organizationId),
          notInArray(leads.status, [...SKIP_LEAD_STATUSES]),
          or(
            isNull(leads.lastContactedAt),
            lt(leads.lastContactedAt, dormantCutoff)
          )
        )
      );

    for (const lead of dormantLeads) {
      // Per-workspace mid-scan limit (do not use global enrolled counter)
      if (
        wouldExceedLeadLimitAfter(
          workspace.monthlyLeadsUsed,
          workspace.monthlyLeadLimit,
          enrolledThisWorkspace
        )
      ) {
        console.log(
          `SDR Scan: workspace ${workspace.id} hit lead limit mid-scan — stopping`
        );
        break;
      }

      const latest = await getLatestEnrollment(config.workspaceId, lead.id);
      const decision = evaluateEnrollmentEligibility({
        lead: {
          status: lead.status,
          consentStatus: lead.consentStatus,
          dncClean: lead.dncClean,
          lastContactedAt: lead.lastContactedAt,
        },
        latestEnrollment: latest,
        workspace: {
          isActive: workspace.isActive,
          monthlyLeadsUsed: workspace.monthlyLeadsUsed + enrolledThisWorkspace,
          monthlyLeadLimit: workspace.monthlyLeadLimit,
        },
        dormantDays: config.dormantDays,
        requireDormant: true,
      });

      if (!decision.ok) {
        skipped++;
        continue;
      }

      try {
        if (decision.mode === "reenroll" && decision.enrollmentId) {
          // exhausted → re_enrolled (same row), clear gate, enqueue call
          await stateMachine.transition(decision.enrollmentId, "re_enrolled", {
            reason: "reactor_reenroll",
            reEnrollDays: config.reEnrollDays,
          });
          await db
            .update(sdrEnrollments)
            .set({
              nextEnrollAfter: null,
              callAttempts: 0,
              currentStep: 1,
              updatedAt: new Date(),
            })
            .where(eq(sdrEnrollments.id, decision.enrollmentId));

          const jobId = await enqueueJob("INITIATE_CALL", decision.enrollmentId);
          await attachJob(decision.enrollmentId, jobId);
          await incrementLeadUsage(config.workspaceId);

          enrolledThisWorkspace++;
          reenrolled++;
          enrolled++;
          console.log(
            `SDR Scan: re-enrolled lead ${lead.id} (enrollment ${decision.enrollmentId}) in workspace ${config.workspaceId}`
          );
        } else {
          const [enrollment] = await db
            .insert(sdrEnrollments)
            .values({
              workspaceId: config.workspaceId,
              leadId: lead.id,
              status: "pending",
              currentStep: 1,
            })
            .returning();

          const jobId = await enqueueJob("INITIATE_CALL", enrollment.id);
          await attachJob(enrollment.id, jobId);
          await incrementLeadUsage(config.workspaceId);

          enrolledThisWorkspace++;
          enrolled++;
          console.log(
            `SDR Scan: enrolled lead ${lead.id} (${lead.firstName} ${lead.lastName}) in workspace ${config.workspaceId}`
          );
        }
      } catch (err: any) {
        skipped++;
        console.error(`SDR Scan: failed to enroll lead ${lead.id}:`, err.message);
      }
    }
  }

  return {
    enrolled,
    reenrolled,
    skipped,
    workspacesScanned,
    workspacesSkippedLimit,
  };
}
