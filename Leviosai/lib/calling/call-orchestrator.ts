// ─── CALL ORCHESTRATOR ────────────────────────────────────────────────────────
// Entry point for every outbound AI call.
// Called by the BullMQ INITIATE_CALL job processor (sdr-queue.ts).
//
// Steps:
//   1. Load enrollment + lead + workspace + config from DB
//   2. TCPA compliance pre-check (quiet hours, DNC, call frequency)
//   3. Create sdr_call_sessions row
//   4. Transition enrollment → call_initiated
//   5. Place outbound Twilio call via workspace sub-account (lib/twilio-subaccount.ts)
//   6. Store Twilio call SID for correlation

import { db } from "../db.js";
import { sdrCallSessions, sdrEnrollments, sdrConfigs, leads, workspaces } from "../schema.js";
import type { EnrollmentStatus } from "../schema.js";
import { stateMachine, TERMINAL_STATUSES } from "../sdr-state-machine.js";
import { enqueueJob, fallThroughToSms, storeEnrollmentJobId } from "../sdr-queue.js";
import { getClientForWorkspace } from "../twilio-subaccount.js";
import { checkCallCompliance } from "../compliance.js";
import { eq, sql } from "drizzle-orm";
import { isSdrDryRun } from "../sdr-dry-run.js";
import { liveCallRegistry } from "./live-call-registry.js";

// ─── ORCHESTRATOR ─────────────────────────────────────────────────────────────

export async function initiateCall(enrollmentId: string): Promise<void> {
  // 1. Load context
  const [enrollment] = await db
    .select()
    .from(sdrEnrollments)
    .where(eq(sdrEnrollments.id, enrollmentId));

  if (!enrollment) throw new Error(`Enrollment ${enrollmentId} not found`);

  const status = enrollment.status as EnrollmentStatus;
  if (TERMINAL_STATUSES.includes(status)) {
    console.log(`SDR Call: enrollment ${enrollmentId} is terminal (${status}) — skip`);
    return;
  }

  // Already past the call step (e.g. duplicate INITIATE_CALL after fall-through)
  if (
    status === "sms_sent" || status === "sms_replied" ||
    status === "email_sent" || status === "email_replied" ||
    status === "call_no_answer" || status === "call_failed"
  ) {
    console.log(`SDR Call: enrollment ${enrollmentId} status ${status} — skip dial`);
    return;
  }

  const [lead] = await db
    .select()
    .from(leads)
    .where(eq(leads.id, enrollment.leadId));

  if (!lead) throw new Error(`Lead ${enrollment.leadId} not found`);

  const [config] = await db
    .select()
    .from(sdrConfigs)
    .where(eq(sdrConfigs.workspaceId, enrollment.workspaceId));

  if (!config || !config.isActive) {
    console.log(`SDR Call: workspace ${enrollment.workspaceId} has no active config — skipping`);
    return;
  }

  // Load workspace for per-client Twilio credentials + usage limits
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, enrollment.workspaceId));

  if (!workspace) throw new Error(`Workspace ${enrollment.workspaceId} not found`);

  // Twilio must be provisioned before dialling (skipped in SDR_DRY_RUN)
  if (!workspace.twilioPhoneNumber && !isSdrDryRun()) {
    console.log(`SDR Call: workspace ${workspace.id} has no phone number — deferring`);
    // Re-queue in 1 hour so provisioning can complete; do not advance state
    const jobId = await enqueueJob("INITIATE_CALL", enrollmentId, 60 * 60 * 1000);
    await storeEnrollmentJobId(enrollmentId, jobId);
    return;
  }

  if (!lead.phone) {
    console.log(`SDR Call: lead ${lead.id} has no phone — falling through to SMS`);
    await fallThroughToSms(enrollmentId, "no_phone", config.waitCallHrs * 60 * 60 * 1000);
    return;
  }

  // ── TCPA / compliance pre-call gate (Module 8 / plan §5) ───────────────────
  // Quiet hours (lead TZ), DNC (Blacklist Alliance + dncClean), frequency, consent.
  // Skipped in SDR_DRY_RUN so Week 5 sequence tests are timezone-independent.
  if (!isSdrDryRun()) {
    const compliant = await checkCallCompliance({
      id: lead.id,
      phone: lead.phone,
      timezone: lead.timezone,
      dncClean: lead.dncClean,
      consentStatus: lead.consentStatus,
    });

    if (!compliant.allowed) {
      if (compliant.reason === "opted_out") {
        console.log(`SDR Call: lead ${lead.id} has opted out — exhausting enrollment`);
        if (stateMachine.canTransition(status, "exhausted")) {
          await stateMachine.transition(enrollmentId, "exhausted", { reason: "opted_out" });
        }
        return;
      }

      if (compliant.reason === "dnc") {
        console.log(`SDR Call: lead ${lead.id} is on DNC list — skipping call, falling to SMS`);
        await fallThroughToSms(enrollmentId, "dnc", 0);
        return;
      }

      if (compliant.reason === "frequency") {
        const next = compliant.nextAllowedAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000);
        const delayMs = Math.max(60_000, next.getTime() - Date.now());
        console.log(
          `SDR Call: lead ${lead.id} hit weekly call frequency — rescheduling in ${Math.round(delayMs / 3600000)}h`
        );
        const jobId = await enqueueJob("INITIATE_CALL", enrollmentId, delayMs);
        await storeEnrollmentJobId(enrollmentId, jobId);
        return;
      }

      // quiet_hours (and any other rescheduleable reason)
      const next = compliant.nextAllowedAt ?? new Date(Date.now() + 60 * 60 * 1000);
      const delayMs = Math.max(60_000, next.getTime() - Date.now());
      console.log(
        `SDR Call: compliance blocked (${compliant.reason}${compliant.detail ? ` ${compliant.detail}` : ""}) — rescheduling in ${Math.round(delayMs / 3600000)}h`
      );
      const jobId = await enqueueJob("INITIATE_CALL", enrollmentId, delayMs);
      await storeEnrollmentJobId(enrollmentId, jobId);
      return;
    }
  }

  const baseUrl = process.env.BASE_URL;
  if (!baseUrl && !isSdrDryRun()) {
    throw new Error("BASE_URL env var is required for Twilio webhooks");
  }

  // 3. Create call session row
  const [session] = await db
    .insert(sdrCallSessions)
    .values({
      workspaceId:  enrollment.workspaceId,
      enrollmentId: enrollment.id,
      leadId:       lead.id,
      status:       "initiated",
      startedAt:    new Date(),
    })
    .returning();

  // 4. Transition enrollment → call_initiated
  //    Allowed from: pending | re_enrolled | call_busy (busy retry)
  if (status === "call_busy" || status === "pending" || status === "re_enrolled") {
    await stateMachine.transition(enrollmentId, "call_initiated", {
      sessionId: session.id,
      priorStatus: status,
    });
  } else if (status !== "call_initiated") {
    // Unexpected — do not dial
    console.warn(`SDR Call: cannot dial from status ${status} for ${enrollmentId}`);
    return;
  }

  // Update enrollment to reference this session + bump attempt counter
  await db
    .update(sdrEnrollments)
    .set({
      callSessionId: session.id,
      callAttempts:  sql`${sdrEnrollments.callAttempts} + 1`,
      updatedAt:     new Date(),
    })
    .where(eq(sdrEnrollments.id, enrollmentId));

  // ── Week 5 dry-run: simulate no-answer without Twilio; caller drives SEND_SMS ──
  if (isSdrDryRun()) {
    await db
      .update(sdrCallSessions)
      .set({
        twilioCallSid: `dry_call_${Date.now()}`,
        status: "completed",
        outcome: "no_answer",
        endedAt: new Date(),
      })
      .where(eq(sdrCallSessions.id, session.id));

    await stateMachine.transition(enrollmentId, "call_no_answer", {
      dryRun: true,
      sessionId: session.id,
    });

    // Only auto-enqueue SMS when a worker is expected (not dry-run processor-driven tests).
    if (process.env.SDR_DRY_RUN_AUTO_SMS === "1") {
      const delayMs = (config.waitCallHrs ?? 0) * 60 * 60 * 1000;
      const jobId = await enqueueJob("SEND_SMS", enrollmentId, delayMs);
      await storeEnrollmentJobId(enrollmentId, jobId);
    }

    console.log(
      `SDR Call: DRY RUN no-answer for lead ${lead.id} (session ${session.id})`
    );
    return;
  }

  // 5. Place outbound Twilio call via workspace sub-account
  const { client: twilioClient, fromNumber } = getClientForWorkspace(workspace);

  if (!fromNumber) {
    throw new Error(`Workspace ${workspace.id} has no provisioned phone number`);
  }

  const call = await twilioClient.calls.create({
    to:   lead.phone,
    from: fromNumber,
    // TwiML endpoint — tells Twilio to open a media stream to our WebSocket
    url:  `${baseUrl}/api/call/connect/${session.id}`,
    // Status callback — fires when call completes/fails/busy
    statusCallback:       `${baseUrl}/api/call/status/${session.id}`,
    statusCallbackMethod: "POST",
    statusCallbackEvent:  ["initiated", "ringing", "answered", "completed"],
    // Recording
    record:                  true,
    recordingStatusCallback: `${baseUrl}/api/call/recording/${session.id}`,
  });

  // 6. Store Twilio call SID for correlation with status webhooks
  await db
    .update(sdrCallSessions)
    .set({ twilioCallSid: call.sid })
    .where(eq(sdrCallSessions.id, session.id));

  liveCallRegistry.start(session.id, workspace.id, []);
  liveCallRegistry.setStatus(session.id, "initiated");

  console.log(`SDR Call: initiated call ${call.sid} for lead ${lead.id} (session ${session.id})`);
}
