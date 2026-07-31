/**
 * Week 5 — Integration tests (plan §17 Week 5), excluding cloud deploy.
 *
 * Covers:
 *  1. Full sequence: dormant → call (dry) → SMS → email → exhausted
 *  2. Multi-workspace isolation (prompts + enrollment scoping)
 *  3. Tier limit enforcement (scan skip + eligibility 429 path)
 *  4. Stripe webhook signed create/update/renew/delete (when server + secret up)
 *  5. Audio pipeline latency budget helpers (<1.5s warn)
 *  6. BullMQ delayed-job persistence across queue reconnect
 *  7. Recording upload/download (S3 or local)
 *
 * Run:  SDR_DRY_RUN=1 npx tsx --test tests/week5-integration.test.ts
 *   or: npm run test:week5
 */

import "dotenv/config";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import fs from "fs/promises";
import path from "path";
import Stripe from "stripe";

import { db } from "../lib/db.js";
import {
  sdrEnrollments,
  sdrLogs,
  sdrConfigs,
  sdrCallSessions,
  workspaces,
} from "../lib/schema.js";
import { eq, and } from "drizzle-orm";
import { scanDormantLeads } from "../lib/sdr-dormant.js";
import { initiateCall } from "../lib/calling/call-orchestrator.js";
import {
  initSdrQueue,
  sdrJobProcessors,
  enqueueJob,
  sdrQueue,
} from "../lib/sdr-queue.js";
import {
  evaluateEnrollmentEligibility,
  wouldExceedLeadLimitAfter,
} from "../lib/sdr-eligibility.js";
import { isLeadLimitReached } from "../lib/tiers.js";
import {
  measureLatency,
  PIPELINE_LATENCY_WARN_MS,
} from "../lib/calling/pipeline-helpers.js";
import {
  getStorageProvider,
  isS3Configured,
  recordingObjectKey,
  uploadRecordingObject,
  downloadRecordingObject,
} from "../lib/blob-storage.js";
import {
  getRecordingsDir,
  recordingFilePath,
  recordingPublicUrl,
} from "../lib/calling/recording-storage.js";
import {
  createWeek5Workspace,
  cleanupWeek5Fixtures,
  cleanupStaleWeek5Orgs,
  waitForEnrollmentStatus,
  type Week5WorkspaceFixture,
} from "./helpers/week5-fixtures.js";

process.env.SDR_DRY_RUN = "1";

const fixtures: Week5WorkspaceFixture[] = [];
let dbOk = false;
let redisOk = false;

function redisConnection(): ConnectionOptions | null {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;
  try {
    const parsed = new URL(redisUrl);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port || "6379"),
      password: parsed.password || undefined,
      tls: redisUrl.startsWith("rediss://") ? {} : undefined,
      maxRetriesPerRequest: null,
    };
  } catch {
    return null;
  }
}

before(async () => {
  await cleanupStaleWeek5Orgs().catch(() => {});
  try {
    await db.select({ id: workspaces.id }).from(workspaces).limit(1);
    dbOk = true;
  } catch (err: any) {
    console.warn("Week5: database unavailable — DB tests will skip:", err.message);
    dbOk = false;
  }

  // Enqueue-only — do not start a worker (avoids racing processor-driven tests).
  // The live `npm run dev` server still runs the full worker.
  if (dbOk && process.env.REDIS_URL) {
    try {
      initSdrQueue({ enableWorker: false });
      redisOk = !!sdrQueue;
    } catch (err: any) {
      console.warn("Week5: Redis/BullMQ unavailable:", err.message);
      redisOk = false;
    }
  }
});

after(async () => {
  if (dbOk && fixtures.length) {
    await cleanupWeek5Fixtures(fixtures).catch((err) =>
      console.warn("Week5 cleanup warning:", err.message)
    );
  }
  try {
    if (sdrQueue) await sdrQueue.close();
  } catch {
    /* ignore */
  }
  // DB + Redis pools keep the event loop alive — exit explicitly after suite.
  setTimeout(() => process.exit(0), 250).unref();
});

// ─── 1. Full sequence E2E ─────────────────────────────────────────────────────

describe("Week5 — full sequence (dormant → call → SMS → email → exhausted)", () => {
  it("drives the no-answer path end-to-end in dry-run", async (t) => {
    if (!dbOk) return t.skip("database unavailable");

    const fx = await createWeek5Workspace({
      tag: "seq",
      prompt: "PROMPT_WORKSPACE_SEQ_UNIQUE_AAA",
      dormantDays: 0,
      waitCallHrs: 0,
      waitSmsHrs: 0,
    });
    fixtures.push(fx);

    const scan = await scanDormantLeads();
    assert.ok(scan.enrolled >= 1, `expected enroll >= 1, got ${JSON.stringify(scan)}`);

    const [enrollment] = await db
      .select()
      .from(sdrEnrollments)
      .where(
        and(
          eq(sdrEnrollments.workspaceId, fx.workspaceId),
          eq(sdrEnrollments.leadId, fx.leadId)
        )
      )
      .limit(1);

    assert.ok(enrollment, "enrollment missing after dormant scan");
    assert.equal(enrollment.status, "pending");

    await initiateCall(enrollment.id);
    let status = await waitForEnrollmentStatus(enrollment.id, ["call_no_answer"]);

    await sdrJobProcessors.SEND_SMS(enrollment.id);
    status = await waitForEnrollmentStatus(enrollment.id, ["sms_sent"]);
    assert.equal(status, "sms_sent");

    await sdrJobProcessors.SMS_TIMEOUT(enrollment.id);
    await sdrJobProcessors.SEND_EMAIL(enrollment.id);
    status = await waitForEnrollmentStatus(enrollment.id, ["email_sent"]);
    assert.equal(status, "email_sent");

    await sdrJobProcessors.EMAIL_TIMEOUT(enrollment.id);
    status = await waitForEnrollmentStatus(enrollment.id, ["exhausted"]);
    assert.equal(status, "exhausted");

    const [final] = await db
      .select()
      .from(sdrEnrollments)
      .where(eq(sdrEnrollments.id, enrollment.id));
    assert.ok(final.nextEnrollAfter, "re-enroll gate should be set on exhausted");

    const logs = await db
      .select({ stepName: sdrLogs.stepName, outcome: sdrLogs.outcome })
      .from(sdrLogs)
      .where(eq(sdrLogs.enrollmentId, enrollment.id));

    const names = logs.map((l) => l.stepName).filter(Boolean);
    assert.ok(names.includes("call_initiated") || names.includes("call_no_answer"));
    assert.ok(names.includes("sms_sent") || names.includes("sms_timeout"));
    assert.ok(names.includes("email_sent") || names.includes("exhausted"));

    const [session] = await db
      .select()
      .from(sdrCallSessions)
      .where(eq(sdrCallSessions.enrollmentId, enrollment.id))
      .limit(1);
    assert.ok(session, "call session should exist");
    assert.equal(session.outcome, "no_answer");
  });
});

// ─── 2. Multi-workspace isolation ─────────────────────────────────────────────

describe("Week5 — multi-workspace isolation", () => {
  it("keeps prompts and enrollments isolated per workspace", async (t) => {
    if (!dbOk) return t.skip("database unavailable");

    const a = await createWeek5Workspace({
      tag: "isoA",
      prompt: "PROMPT_ISOLATION_ALPHA_NEVER_LEAK",
    });
    const b = await createWeek5Workspace({
      tag: "isoB",
      prompt: "PROMPT_ISOLATION_BETA_NEVER_LEAK",
    });
    fixtures.push(a, b);

    const [cfgA] = await db
      .select()
      .from(sdrConfigs)
      .where(eq(sdrConfigs.workspaceId, a.workspaceId));
    const [cfgB] = await db
      .select()
      .from(sdrConfigs)
      .where(eq(sdrConfigs.workspaceId, b.workspaceId));

    assert.equal(cfgA.systemPrompt, a.prompt);
    assert.equal(cfgB.systemPrompt, b.prompt);
    assert.notEqual(cfgA.systemPrompt, cfgB.systemPrompt);

    await scanDormantLeads();

    const enrollA = await db
      .select()
      .from(sdrEnrollments)
      .where(eq(sdrEnrollments.workspaceId, a.workspaceId));
    const enrollB = await db
      .select()
      .from(sdrEnrollments)
      .where(eq(sdrEnrollments.workspaceId, b.workspaceId));

    assert.ok(enrollA.length >= 1);
    assert.ok(enrollB.length >= 1);
    assert.ok(enrollA.every((e) => e.workspaceId === a.workspaceId));
    assert.ok(enrollB.every((e) => e.workspaceId === b.workspaceId));
    assert.ok(enrollA.every((e) => e.leadId === a.leadId));
    assert.ok(enrollB.every((e) => e.leadId === b.leadId));

    // Cross-query: workspace A filter must not return B's enrollment
    const leaked = await db
      .select()
      .from(sdrEnrollments)
      .where(
        and(
          eq(sdrEnrollments.workspaceId, a.workspaceId),
          eq(sdrEnrollments.leadId, b.leadId)
        )
      );
    assert.equal(leaked.length, 0);
  });
});

// ─── 3. Tier limit enforcement ────────────────────────────────────────────────

describe("Week5 — tier limit enforcement", () => {
  it("blocks eligibility and scan when monthly lead limit is reached", async (t) => {
    if (!dbOk) return t.skip("database unavailable");

    assert.equal(isLeadLimitReached(500, 500), true);
    assert.equal(wouldExceedLeadLimitAfter(499, 500, 1), true);
    assert.equal(wouldExceedLeadLimitAfter(498, 500, 1), false);

    const fx = await createWeek5Workspace({
      tag: "limit",
      prompt: "PROMPT_LIMIT",
      monthlyLeadLimit: 1,
      monthlyLeadsUsed: 1,
    });
    fixtures.push(fx);

    const denied = evaluateEnrollmentEligibility({
      lead: { status: "new", consentStatus: "granted", dncClean: true, lastContactedAt: null },
      latestEnrollment: null,
      workspace: {
        isActive: true,
        monthlyLeadsUsed: 1,
        monthlyLeadLimit: 1,
      },
      dormantDays: 0,
      requireDormant: true,
    });
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.reason, "lead_limit");

    const before = await db
      .select()
      .from(sdrEnrollments)
      .where(eq(sdrEnrollments.workspaceId, fx.workspaceId));

    const scan = await scanDormantLeads();
    assert.ok(scan.workspacesSkippedLimit >= 1 || scan.enrolled === 0);

    const after = await db
      .select()
      .from(sdrEnrollments)
      .where(eq(sdrEnrollments.workspaceId, fx.workspaceId));
    assert.equal(after.length, before.length, "at-limit workspace must not gain enrollments");
  });
});

// ─── 4. Stripe webhooks ───────────────────────────────────────────────────────

describe("Week5 — Stripe webhook events", () => {
  it("accepts signed create/update/invoice.paid/delete and rejects unsigned", async (t) => {
    const base = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
    const secret = process.env.STRIPE_WEBHOOK_SECRET || "";
    const key = process.env.STRIPE_SECRET_KEY || "";

    if (!secret || secret.startsWith("REPLACE") || !key) {
      return t.skip("Stripe webhook secret / key not configured");
    }

    let healthy = false;
    try {
      const h = await fetch(`${base}/api/health`).then((r) => r.json());
      healthy = !!h;
    } catch {
      healthy = false;
    }
    if (!healthy) return t.skip("API server not reachable for webhook test");

    const unsigned = await fetch(`${base}/api/billing/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(unsigned.status, 400);

    const stripe = new Stripe(key);
    async function post(type: string, object: Record<string, unknown>) {
      const payload = JSON.stringify({
        id: `evt_w5_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        object: "event",
        api_version: "2024-11-20.acacia",
        created: Math.floor(Date.now() / 1000),
        type,
        data: { object },
        livemode: false,
        pending_webhooks: 1,
        request: { id: null, idempotency_key: null },
      });
      const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
      const res = await fetch(`${base}/api/billing/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Stripe-Signature": header,
        },
        body: payload,
      });
      return res.status;
    }

    const customerId = `cus_w5_${Date.now()}`;
    const subId = `sub_w5_${Date.now()}`;
    const price =
      process.env.STRIPE_STARTER_PRICE_ID ||
      process.env.STRIPE_GROWTH_PRICE_ID ||
      "price_test";

    assert.equal(
      await post("customer.subscription.created", {
        id: subId,
        object: "subscription",
        customer: customerId,
        status: "active",
        items: { data: [{ price: { id: price } }] },
        metadata: { planKey: "starter" },
      }),
      200
    );
    assert.equal(
      await post("customer.subscription.updated", {
        id: subId,
        object: "subscription",
        customer: customerId,
        status: "active",
        items: { data: [{ price: { id: price } }] },
        metadata: { planKey: "starter" },
      }),
      200
    );
    assert.equal(
      await post("invoice.paid", {
        id: `in_w5_${Date.now()}`,
        object: "invoice",
        customer: customerId,
        subscription: subId,
        status: "paid",
      }),
      200
    );
    assert.equal(
      await post("customer.subscription.deleted", {
        id: subId,
        object: "subscription",
        customer: customerId,
        status: "canceled",
      }),
      200
    );
  });
});

// ─── 5. Audio latency budget ──────────────────────────────────────────────────

describe("Week5 — audio pipeline latency budget", () => {
  it("flags totals over the 1.5s plan budget", () => {
    assert.equal(PIPELINE_LATENCY_WARN_MS, 1500);
    const over = measureLatency(0, 400, 1600);
    assert.equal(over.totalMs, 1600);
    assert.equal(over.overBudget, true);

    const under = measureLatency(0, 200, 900);
    assert.equal(under.overBudget, false);
  });
});

// ─── 6. BullMQ persistence ────────────────────────────────────────────────────

describe("Week5 — BullMQ job persistence", () => {
  it("delayed jobs survive queue client reconnect", async (t) => {
    const conn = redisConnection();
    if (!conn) return t.skip("REDIS_URL not set");

    const queueName = "sdr-sequence-week5-probe";
    const q1 = new Queue(queueName, { connection: conn });
    const job = await q1.add(
      "EMAIL_TIMEOUT",
      { enrollmentId: "00000000-0000-0000-0000-0000000000w5" },
      { delay: 120_000, removeOnComplete: true, removeOnFail: true }
    );
    assert.ok(job.id);

    await q1.close();

    const q2 = new Queue(queueName, { connection: conn });
    const found = await q2.getJob(job.id!);
    assert.ok(found, "job must still exist after reconnect");
    assert.equal(found.name, "EMAIL_TIMEOUT");
    const state = await found.getState();
    assert.ok(state === "delayed" || state === "waiting");

    await found.remove();
    await q2.close();

    // Also smoke the live SDR queue enqueue when initialized
    if (redisOk && dbOk) {
      const id = await enqueueJob(
        "EMAIL_TIMEOUT",
        "00000000-0000-0000-0000-0000000000w5",
        180_000
      );
      if (id && sdrQueue) {
        const live = await sdrQueue.getJob(id);
        assert.ok(live);
        await live.remove();
      }
    }
  });
});

// ─── 7. Recording upload ──────────────────────────────────────────────────────

describe("Week5 — recording upload / retrieval", () => {
  it("persists a sample recording and reads it back", async () => {
    const sessionId = `w5rec_${Date.now()}`;
    const bytes = Buffer.from("ID3fake-mp3-week5-recording-bytes");

    if (getStorageProvider() === "s3" && isS3Configured()) {
      const key = recordingObjectKey(sessionId);
      await uploadRecordingObject({
        key,
        body: bytes,
        contentType: "audio/mpeg",
      });
      const downloaded = await downloadRecordingObject(key);
      assert.ok(downloaded, "S3 download should return a body");
      const chunks: Buffer[] = [];
      for await (const chunk of downloaded!.body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      assert.equal(Buffer.concat(chunks).toString(), bytes.toString());
    } else {
      const dir = getRecordingsDir();
      await fs.mkdir(dir, { recursive: true });
      const file = recordingFilePath(sessionId, "mp3");
      await fs.writeFile(file, bytes);
      const read = await fs.readFile(file);
      assert.equal(read.toString(), bytes.toString());
      await fs.unlink(file).catch(() => {});
    }

    process.env.BASE_URL = process.env.BASE_URL || "http://localhost:3000";
    const url = recordingPublicUrl(sessionId);
    assert.match(url, /\/api\/call\/recordings\/w5rec_/);
    assert.ok(!url.includes(path.sep + ".."));
  });
});
