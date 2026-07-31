// ─── SDR JOB QUEUE ────────────────────────────────────────────────────────────
// BullMQ replaces n8n's wait nodes. Every time-delayed step in the SDR sequence
// is an enqueued job with a delay parameter. The worker picks up each job and
// calls the appropriate service or state machine transition.
//
// Job types:
//   INITIATE_CALL  — place outbound AI call (Module 2)
//   SEND_SMS       — send SMS after unanswered call (delay: waitCallHrs)
//   SMS_TIMEOUT    — fires if no SMS reply (delay: waitSmsHrs) → triggers email
//   SEND_EMAIL     — send follow-up email after SMS timeout
//   EMAIL_TIMEOUT  — fires if no email reply (delay: 48hrs) → exhausted

import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { db } from "./db.js";
import { sdrEnrollments, sdrConfigs, workspaces, sdrLogs, organizations } from "./schema.js";
import type { EnrollmentStatus } from "./schema.js";
import {
  stateMachine,
  SMS_READY_STATUSES,
} from "./sdr-state-machine.js";
import { planSmsFallthrough } from "./sdr-m1-logic.js";
import { computeNextEnrollAfter } from "./sdr-eligibility.js";
import { eq } from "drizzle-orm";
import { sendEmailViaGmail } from "./gmail/send.js";
import { getClientForWorkspace } from "./twilio-subaccount.js";
import { isSdrDryRun } from "./sdr-dry-run.js";
import { buildSdrTemplateContext, renderSdrTemplate } from "./sdr-template-vars.js";

// ─── REDIS CONNECTION ─────────────────────────────────────────────────────────
// BullMQ needs its own ioredis connection config.
// Reuses REDIS_URL from the environment (same as existing Redis setup).

function buildRedisConnection(): ConnectionOptions {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is required for BullMQ job queue");
  }
  const parsed = new URL(redisUrl);
  return {
    host:     parsed.hostname,
    port:     parseInt(parsed.port || "6379"),
    password: parsed.password || undefined,
    tls:      redisUrl.startsWith("rediss://") ? {} : undefined,
    maxRetriesPerRequest: null, // required by BullMQ
  };
}

// ─── JOB TYPE DEFINITIONS ─────────────────────────────────────────────────────

export type SDRJobName =
  | "INITIATE_CALL"
  | "SEND_SMS"
  | "SMS_TIMEOUT"
  | "SEND_EMAIL"
  | "EMAIL_TIMEOUT";

export interface SDRJobData {
  enrollmentId: string;
}

// ─── QUEUE + WORKER ───────────────────────────────────────────────────────────

let sdrQueue: Queue<SDRJobData, void, SDRJobName> | null = null;
let sdrWorker: Worker<SDRJobData, void, SDRJobName> | null = null;

export function initSdrQueue(opts: { enableWorker?: boolean } = {}): void {
  if (!process.env.REDIS_URL) {
    console.warn("⚠️  SDR Queue: REDIS_URL not set — BullMQ disabled");
    return;
  }

  const enableWorker = opts.enableWorker !== false;

  try {
    const connection = buildRedisConnection();

    sdrQueue = new Queue<SDRJobData, void, SDRJobName>("sdr-sequence", {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail:     { count: 50 },
      },
    });

    if (enableWorker) {
      sdrWorker = new Worker<SDRJobData, void, SDRJobName>(
        "sdr-sequence",
        async (job) => {
          const { enrollmentId } = job.data;
          console.log(`SDR Queue: processing job ${job.name} for enrollment ${enrollmentId}`);

          switch (job.name) {
            case "INITIATE_CALL":
              await handleInitiateCall(enrollmentId);
              break;

            case "SEND_SMS":
              await handleSendSms(enrollmentId);
              break;

            case "SMS_TIMEOUT":
              await handleSmsTimeout(enrollmentId);
              break;

            case "SEND_EMAIL":
              await handleSendEmail(enrollmentId);
              break;

            case "EMAIL_TIMEOUT":
              await handleEmailTimeout(enrollmentId);
              break;
          }
        },
        { connection }
      );

      sdrWorker.on("completed", (job) => {
        console.log(`✅ SDR job ${job.name} completed for enrollment ${job.data.enrollmentId}`);
      });

      sdrWorker.on("failed", (job, err) => {
        console.error(`❌ SDR job ${job?.name} failed for enrollment ${job?.data.enrollmentId}:`, err.message);
      });
    }

    console.log(
      enableWorker
        ? "✅ SDR BullMQ queue initialized"
        : "✅ SDR BullMQ queue initialized (enqueue-only, no worker)"
    );
  } catch (err: any) {
    console.error("⚠️  SDR Queue initialization failed:", err.message);
  }
}

// ─── ENQUEUE HELPERS ──────────────────────────────────────────────────────────

export async function enqueueJob(
  jobName: SDRJobName,
  enrollmentId: string,
  delayMs = 0
): Promise<string | null> {
  if (!sdrQueue) {
    console.warn("SDR Queue not initialized — cannot enqueue", jobName);
    return null;
  }
  const job = await sdrQueue.add(jobName, { enrollmentId }, { delay: delayMs });
  return job.id ?? null;
}

export async function cancelJob(jobId: string): Promise<void> {
  if (!sdrQueue) return;
  const job = await sdrQueue.getJob(jobId);
  if (job) await job.remove();
}

/**
 * Store the BullMQ job id on the enrollment so inbound replies / recovery
 * can cancel or replace it later.
 */
export async function storeEnrollmentJobId(
  enrollmentId: string,
  jobId: string | null
): Promise<void> {
  if (!jobId) return;
  await db
    .update(sdrEnrollments)
    .set({ bullmqJobId: jobId, updatedAt: new Date() })
    .where(eq(sdrEnrollments.id, enrollmentId));
}

/**
 * Skip the dial step and advance into the SMS branch.
 * Used when: minute limit hit, no phone, DNC, max busy retries, stuck recovery.
 *
 * Ensures enrollment is in an SMS-ready status, then enqueues SEND_SMS.
 */
export async function fallThroughToSms(
  enrollmentId: string,
  reason: string,
  delayMs = 0
): Promise<void> {
  const [enrollment] = await db
    .select()
    .from(sdrEnrollments)
    .where(eq(sdrEnrollments.id, enrollmentId));

  if (!enrollment) {
    console.error(`SDR fallThroughToSms: enrollment ${enrollmentId} not found`);
    return;
  }

  const status = enrollment.status as EnrollmentStatus;
  const plan = planSmsFallthrough(status);

  if (plan.kind === "skip") {
    console.log(`SDR fallThroughToSms: enrollment ${enrollmentId} skipped (${plan.reason})`);
    return;
  }

  if (plan.kind === "advance") {
    for (const step of plan.steps) {
      await stateMachine.transition(enrollmentId, step, {
        reason: step === plan.steps[plan.steps.length - 1] ? reason : `${reason}_skip_dial`,
      });
    }
  }
  // plan.kind === "sms_ready" → already legal for SEND_SMS

  const jobId = await enqueueJob("SEND_SMS", enrollmentId, delayMs);
  await storeEnrollmentJobId(enrollmentId, jobId);
  console.log(`SDR: fall-through to SMS for ${enrollmentId} (reason=${reason}, delayMs=${delayMs})`);
}

// ─── JOB PROCESSORS ───────────────────────────────────────────────────────────

async function handleInitiateCall(enrollmentId: string): Promise<void> {
  const { initiateCall } = await import("./calling/call-orchestrator.js");
  await initiateCall(enrollmentId);
}

async function handleSendSms(enrollmentId: string): Promise<void> {
  const { enrollment, lead, config } = await loadEnrollmentContext(enrollmentId);
  if (!enrollment || !lead || !config) return;

  const status = enrollment.status as EnrollmentStatus;
  if (!SMS_READY_STATUSES.includes(status)) {
    console.warn(
      `SDR: SEND_SMS skipped for ${enrollmentId} — status ${status} is not SMS-ready`
    );
    return;
  }

  // Load workspace for per-client Twilio credentials
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, enrollment.workspaceId));

  if (!workspace) {
    console.error(`SDR: workspace ${enrollment.workspaceId} not found for SMS`);
    return;
  }

  const [org] = workspace.organizationId
    ? await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, workspace.organizationId))
    : [null];
  const body = renderSdrTemplate(
    config.smsTemplate,
    buildSdrTemplateContext(lead, org?.name)
  );

  let smsSid: string | undefined;
  let smsError: string | undefined;

  try {
    if (isSdrDryRun()) {
      smsSid = `dry_sms_${Date.now()}`;
      console.log(`SDR: DRY RUN SMS for ${enrollmentId}: ${body.slice(0, 80)}`);
    } else {
      const { client: twilioClient, fromNumber } = getClientForWorkspace(workspace);
      if (!fromNumber) throw new Error("No phone number provisioned for this workspace");
      if (!lead.phone) throw new Error("Lead has no phone number");
      const message = await twilioClient.messages.create({
        body,
        from: fromNumber,
        to:   lead.phone,
      });
      smsSid = message.sid;
    }
  } catch (err: any) {
    smsError = err.message;
  }

  if (smsSid) {
    // Re-read status to survive races with a parallel worker/processor.
    const [fresh] = await db
      .select({ status: sdrEnrollments.status })
      .from(sdrEnrollments)
      .where(eq(sdrEnrollments.id, enrollmentId));
    const freshStatus = fresh?.status as EnrollmentStatus | undefined;

    if (freshStatus === "sms_sent") {
      console.log(`SDR: SEND_SMS already applied for ${enrollmentId} — ensuring timeout job`);
    } else if (freshStatus && SMS_READY_STATUSES.includes(freshStatus)) {
      await stateMachine.transition(enrollmentId, "sms_sent", { smsSid });
    } else {
      console.warn(
        `SDR: SEND_SMS skipped transition for ${enrollmentId} — status ${freshStatus}`
      );
      return;
    }

    // Enqueue SMS timeout — if no reply within waitSmsHrs, proceed to email
    const delayMs = config.waitSmsHrs * 60 * 60 * 1000;
    const timeoutJobId = await enqueueJob("SMS_TIMEOUT", enrollmentId, delayMs);
    await storeEnrollmentJobId(enrollmentId, timeoutJobId);
  } else {
    console.error(`SDR: SMS failed for enrollment ${enrollmentId}:`, smsError);
  }
}

async function handleSmsTimeout(enrollmentId: string): Promise<void> {
  // No SMS reply within waitSmsHrs — enqueue email.
  // Do NOT transition to email_sent here: SEND_EMAIL owns that transition after a successful send.
  const { enrollment } = await loadEnrollmentContext(enrollmentId);
  if (!enrollment) return;

  if (enrollment.status !== "sms_sent") {
    console.log(
      `SDR: SMS_TIMEOUT ignored for ${enrollmentId} — status is ${enrollment.status} (likely replied)`
    );
    return;
  }

  await db.insert(sdrLogs).values({
    workspaceId:  enrollment.workspaceId,
    enrollmentId: enrollment.id,
    leadId:       enrollment.leadId,
    step:         enrollment.currentStep,
    stepName:     "sms_timeout",
    outcome:      "no_reply",
    payload:      { reason: "sms_timeout" },
    loggedAt:     new Date(),
  });

  const jobId = await enqueueJob("SEND_EMAIL", enrollmentId, 0);
  await storeEnrollmentJobId(enrollmentId, jobId);
}

async function handleSendEmail(enrollmentId: string): Promise<void> {
  const { enrollment, lead, config } = await loadEnrollmentContext(enrollmentId);
  if (!enrollment || !lead || !config) return;

  if (enrollment.status !== "sms_sent") {
    console.warn(
      `SDR: SEND_EMAIL skipped for ${enrollmentId} — expected sms_sent, got ${enrollment.status}`
    );
    return;
  }

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, enrollment.workspaceId));

  if (!workspace?.organizationId) {
    console.error(`SDR: SEND_EMAIL aborted — workspace ${enrollment.workspaceId} missing organization`);
    return;
  }

  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, workspace.organizationId));

  const subject = renderSdrTemplate(
    config.emailSubject,
    buildSdrTemplateContext(lead, org?.name)
  );
  const body = renderSdrTemplate(
    config.emailBody,
    buildSdrTemplateContext(lead, org?.name)
  );

  // BYOT Gmail — same model as Twilio for SMS (send from the customer's own account)
  const result = isSdrDryRun()
    ? { success: true as const, id: `dry_email_${Date.now()}`, from: "dry-run@leviosai.test" }
    : await sendEmailViaGmail(workspace.organizationId, lead.email, subject, body);

  if (isSdrDryRun()) {
    console.log(`SDR: DRY RUN email for ${enrollmentId}: ${subject}`);
  }

  if (result.success) {
    const [fresh] = await db
      .select({ status: sdrEnrollments.status })
      .from(sdrEnrollments)
      .where(eq(sdrEnrollments.id, enrollmentId));

    if (fresh?.status === "email_sent") {
      console.log(`SDR: SEND_EMAIL already applied for ${enrollmentId}`);
    } else if (fresh?.status === "sms_sent") {
      await stateMachine.transition(enrollmentId, "email_sent", {
        emailId: (result as any).id,
      });
    } else {
      console.warn(
        `SDR: SEND_EMAIL skipped transition for ${enrollmentId} — status ${fresh?.status}`
      );
      return;
    }

    // Enqueue 48-hour email timeout
    const delayMs = 48 * 60 * 60 * 1000;
    const timeoutJobId = await enqueueJob("EMAIL_TIMEOUT", enrollmentId, delayMs);
    await storeEnrollmentJobId(enrollmentId, timeoutJobId);
  } else {
    console.error(`SDR: Email failed for enrollment ${enrollmentId}:`, result.error);
  }
}

async function handleEmailTimeout(enrollmentId: string): Promise<void> {
  // No email reply after 48 hours — sequence exhausted
  const { enrollment, config } = await loadEnrollmentContext(enrollmentId);
  if (!enrollment || !config) return;

  if (enrollment.status !== "email_sent") {
    console.log(
      `SDR: EMAIL_TIMEOUT ignored for ${enrollmentId} — status is ${enrollment.status}`
    );
    return;
  }

  await stateMachine.transition(enrollmentId, "exhausted", { reason: "email_timeout" });

  // Schedule re-enrollment: set nextEnrollAfter so the Reactor picks it up later
  const reEnrollAt = computeNextEnrollAfter(config.reEnrollDays);

  await db
    .update(sdrEnrollments)
    .set({ nextEnrollAfter: reEnrollAt, updatedAt: new Date() })
    .where(eq(sdrEnrollments.id, enrollmentId));
}

// ─── CONTEXT LOADER ───────────────────────────────────────────────────────────
// Loads enrollment + lead + sdrConfig in one place to avoid repetition across handlers.

async function loadEnrollmentContext(enrollmentId: string) {
  const [enrollment] = await db
    .select()
    .from(sdrEnrollments)
    .where(eq(sdrEnrollments.id, enrollmentId));

  if (!enrollment) {
    console.error(`SDR: enrollment ${enrollmentId} not found`);
    return { enrollment: null, lead: null, config: null };
  }

  // Import leads table inline to avoid circular dependency
  const { leads } = await import("./schema.js");
  const [lead] = await db.select().from(leads).where(eq(leads.id, enrollment.leadId));

  const [config] = await db
    .select()
    .from(sdrConfigs)
    .where(eq(sdrConfigs.workspaceId, enrollment.workspaceId));

  return { enrollment, lead: lead ?? null, config: config ?? null };
}

export { sdrQueue, sdrWorker };

/** Direct processors for Week 5 integration tests (bypass BullMQ worker). */
export const sdrJobProcessors = {
  INITIATE_CALL: handleInitiateCall,
  SEND_SMS: handleSendSms,
  SMS_TIMEOUT: handleSmsTimeout,
  SEND_EMAIL: handleSendEmail,
  EMAIL_TIMEOUT: handleEmailTimeout,
};
