// ─── CALL ROUTES ─────────────────────────────────────────────────────────────
// Handles the full Twilio call lifecycle:
//   POST /api/call/connect/:sessionId  — TwiML, returns Stream XML to Twilio
//   WS   /api/call/stream/:sessionId   — WebSocket: Twilio audio ↔ AI pipeline
//   POST /api/call/status/:sessionId   — Twilio call status callback
//   POST /api/call/recording/:sessionId— Twilio recording ready callback
//   GET  /api/call/sessions            — Paginated call history (workspace-scoped)
//   GET  /api/call/sessions/:id        — Single call session detail
//   GET  /api/call/voices              — ElevenLabs voice list for frontend dropdown
//   GET  /api/call/analytics           — Call funnel metrics for workspace

import { Router, Request, Response } from "express";
import twilio from "twilio";
import type WebSocket from "ws";
import { db } from "../lib/db.js";
import {
  sdrCallSessions,
  sdrEnrollments,
  sdrConfigs,
  workspaces,
  leads,
} from "../lib/schema.js";
import {
  stateMachine,
  MAX_CALL_ATTEMPTS,
  BUSY_RETRY_DELAY_MS,
} from "../lib/sdr-state-machine.js";
import { enqueueJob, fallThroughToSms, storeEnrollmentJobId } from "../lib/sdr-queue.js";
import { shouldRetryBusyCall } from "../lib/sdr-m1-logic.js";
import { AudioPipeline } from "../lib/calling/audio-pipeline.js";
import { ElevenLabsClient } from "../lib/calling/elevenlabs-client.js";
import { persistTwilioRecording, openRecordingStream } from "../lib/calling/recording-storage.js";
import { decrypt } from "../lib/crypto.js";
import { requireAuth } from "./auth.js";
import { workspaceScope } from "../middleware/workspaceScope.js";
import { validateTwilioCallSession } from "../middleware/twilioSignature.js";
import { eq, and, desc, count, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { bookAppointmentWithCalendar } from "../lib/calendar/service.js";
import { parseScheduledAt } from "../lib/calendar/booking-helpers.js";
import { ensureAppointmentCalendarColumns } from "../lib/calendar/schema-ensure.js";

const router = Router();
const elevenlabs = new ElevenLabsClient();

// ─── POST /api/call/connect ───────────────────────────────────────────────────
// Fallback TwiML for manual calls placed from the lead detail "Voice AI Call"
// button — no session ID, no AI pipeline. Just a basic connected call.

router.post("/api/call/connect", (req: Request, res: Response) => {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  twiml.say({ voice: "Polly.Joanna" }, "Hello, this is a test call from Leviosai. The AI pipeline is ready.");
  twiml.pause({ length: 2 });
  twiml.hangup();
  res.type("text/xml").send(twiml.toString());
});

// ─── POST /api/call/connect/:sessionId ───────────────────────────────────────
// Called by Twilio when the lead answers via the full SDR AI pipeline.
// Returns TwiML that opens a bidirectional media stream WebSocket.

router.post("/api/call/connect/:sessionId", validateTwilioCallSession, async (req: Request, res: Response) => {
  const sessionId = req.params.sessionId as string;
  const baseUrl   = process.env.BASE_URL ?? `https://${req.hostname}`;

  // Lead answered — advance enrollment call_initiated → call_connected
  try {
    const [session] = await db
      .select()
      .from(sdrCallSessions)
      .where(eq(sdrCallSessions.id, sessionId));

    if (session?.enrollmentId) {
      const [enrollment] = await db
        .select()
        .from(sdrEnrollments)
        .where(eq(sdrEnrollments.id, session.enrollmentId));

      if (enrollment && stateMachine.canTransition(enrollment.status as any, "call_connected")) {
        await stateMachine.transition(enrollment.id, "call_connected", { sessionId });
      }
    }
  } catch (err: any) {
    console.error(`Call connect state transition failed for ${sessionId}:`, err.message);
    // Still return TwiML so the call is not dropped
  }

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  const connect = twiml.connect();

  connect.stream({
    url:   `wss://${new URL(baseUrl).hostname}/api/call/stream/${sessionId}`,
    track: "inbound_track",
  });

  res.type("text/xml").send(twiml.toString());
});

// ─── WS /api/call/stream/:sessionId ──────────────────────────────────────────
// WebSocket endpoint — receives Twilio media stream.
// Registered by server.ts on the HTTP server directly (not Express middleware).
// This handler is exported and called from server.ts WebSocket upgrade handler.

export async function handleCallStream(ws: WebSocket, sessionId: string): Promise<void> {
  const pipeline = new AudioPipeline();
  await pipeline.handleStream(ws, sessionId).catch((err: Error) => {
    console.error(`Audio pipeline error for session ${sessionId}:`, err.message);
    ws.close(1011, err.message);
  });
}

// ─── POST /api/call/status/:sessionId ────────────────────────────────────────
// Twilio call status callback — fires when call completes, fails, busy, or no-answer.

router.post("/api/call/status/:sessionId", validateTwilioCallSession, async (req: Request, res: Response) => {
  const sessionId  = req.params.sessionId as string;
  const callStatus = req.body.CallStatus  as string;  // completed | no-answer | busy | failed
  const callDuration = parseInt(req.body.CallDuration || "0");

  try {
    const [session] = await db
      .select()
      .from(sdrCallSessions)
      .where(eq(sdrCallSessions.id, sessionId));

    if (!session) return res.sendStatus(200); // already processed or not found

    const enrollment = session.enrollmentId
      ? (await db.select().from(sdrEnrollments).where(eq(sdrEnrollments.id, session.enrollmentId)))[0] ?? null
      : null;

    const [config] = enrollment
      ? await db.select().from(sdrConfigs).where(eq(sdrConfigs.workspaceId, enrollment.workspaceId))
      : [];

    const waitSmsMs = (config?.waitCallHrs ?? 2) * 60 * 60 * 1000;

    // ── Always update session status/outcome/endedAt based on Twilio's callStatus ──
    // This ensures the session record is always in a terminal state after the call ends,
    // even if the audio pipeline's endCall() didn't run (e.g. unanswered calls).
    if (callStatus === "no-answer") {
      await db.update(sdrCallSessions)
        .set({ status: "completed", outcome: "no_answer", endedAt: new Date() })
        .where(and(eq(sdrCallSessions.id, sessionId), sql`status != 'completed'`));
    } else if (callStatus === "failed") {
      await db.update(sdrCallSessions)
        .set({ status: "completed", outcome: "failed", endedAt: new Date() })
        .where(and(eq(sdrCallSessions.id, sessionId), sql`status != 'completed'`));
    } else if (callStatus === "busy") {
      await db.update(sdrCallSessions)
        .set({ status: "completed", outcome: "busy", endedAt: new Date() })
        .where(and(eq(sdrCallSessions.id, sessionId), sql`status != 'completed'`));
    } else if (callStatus === "completed") {
      // Set duration + ensure status=completed (audio-pipeline may have already done this)
      await db.update(sdrCallSessions)
        .set({ durationSeconds: callDuration, status: "completed", endedAt: new Date() })
        .where(eq(sdrCallSessions.id, sessionId));
    }

    // SDR sequence state machine transitions — only for enrolled calls
    if (enrollment) {
      // Refresh enrollment so callAttempts reflects the increment from initiateCall
      const [fresh] = await db
        .select()
        .from(sdrEnrollments)
        .where(eq(sdrEnrollments.id, enrollment.id));
      const attempts = fresh?.callAttempts ?? enrollment.callAttempts;

      if (callStatus === "no-answer") {
        await stateMachine.transition(enrollment.id, "call_no_answer", { callStatus, attempts });
        const jobId = await enqueueJob("SEND_SMS", enrollment.id, waitSmsMs);
        await storeEnrollmentJobId(enrollment.id, jobId);
      }

      if (callStatus === "failed") {
        // call_failed → SEND_SMS (plan §2 Step 4 / state machine)
        await stateMachine.transition(enrollment.id, "call_failed", { callStatus, attempts });
        const jobId = await enqueueJob("SEND_SMS", enrollment.id, waitSmsMs);
        await storeEnrollmentJobId(enrollment.id, jobId);
      }

      // Busy: retry up to MAX_CALL_ATTEMPTS total dials, then fall through to SMS
      if (callStatus === "busy") {
        await stateMachine.transition(enrollment.id, "call_busy", { callStatus, attempts });

        if (shouldRetryBusyCall(attempts)) {
          const jobId = await enqueueJob("INITIATE_CALL", enrollment.id, BUSY_RETRY_DELAY_MS);
          await storeEnrollmentJobId(enrollment.id, jobId);
          console.log(
            `SDR: busy — retry ${attempts}/${MAX_CALL_ATTEMPTS} for ${enrollment.id} in ${BUSY_RETRY_DELAY_MS / 60000}m`
          );
        } else {
          console.log(
            `SDR: busy — max attempts (${attempts}) reached for ${enrollment.id} — fall through to SMS`
          );
          await fallThroughToSms(enrollment.id, "max_busy_retries", waitSmsMs);
        }
      }

      if (callStatus === "completed") {
        // Re-read enrollment — connect webhook may have moved it to call_connected
        const [current] = await db
          .select()
          .from(sdrEnrollments)
          .where(eq(sdrEnrollments.id, enrollment.id));

        const [updatedSession] = await db
          .select()
          .from(sdrCallSessions)
          .where(eq(sdrCallSessions.id, sessionId));

        const outcome = updatedSession?.outcome;
        const st = (current?.status ?? enrollment.status) as string;

        if (outcome === "booked") {
          if (st === "call_initiated" && stateMachine.canTransition("call_initiated", "call_connected")) {
            await stateMachine.transition(enrollment.id, "call_connected", { outcome });
          }
          const [mid] = await db.select().from(sdrEnrollments).where(eq(sdrEnrollments.id, enrollment.id));
          if (mid && stateMachine.canTransition(mid.status as any, "call_answered")) {
            await stateMachine.transition(enrollment.id, "call_answered", { outcome });
          }
          await stateMachine.transition(enrollment.id, "booked", { outcome });

          // Module 10 — create CRM appointment + sync to active calendar when a slot was captured
          try {
            await ensureAppointmentCalendarColumns();
            const scheduledAt = parseScheduledAt(updatedSession?.bookedScheduledAt);
            if (scheduledAt && session.leadId) {
              const [ws] = await db
                .select()
                .from(workspaces)
                .where(eq(workspaces.id, enrollment.workspaceId));
              if (ws?.organizationId) {
                const [lead] = await db.select().from(leads).where(eq(leads.id, session.leadId));
                const result = await bookAppointmentWithCalendar({
                  organizationId: ws.organizationId,
                  leadId: session.leadId,
                  title: "Consultation",
                  scheduledAt,
                  attendeeEmail: lead?.email,
                  attendeeName: lead
                    ? [lead.firstName, lead.lastName].filter(Boolean).join(" ")
                    : null,
                  description: updatedSession?.aiSummary || undefined,
                });
                if (!result.synced && result.syncError) {
                  console.warn(
                    `Calendar sync skipped/failed for session ${sessionId}: ${result.syncError}`
                  );
                }
              }
            }
          } catch (bookErr: any) {
            console.warn(`Appointment booking after call failed: ${bookErr.message}`);
          }
        } else if (outcome === "qualified" || outcome === "answered") {
          if (st === "call_initiated" && stateMachine.canTransition("call_initiated", "call_connected")) {
            await stateMachine.transition(enrollment.id, "call_connected", { outcome });
          }
          const [mid] = await db.select().from(sdrEnrollments).where(eq(sdrEnrollments.id, enrollment.id));
          if (mid && stateMachine.canTransition(mid.status as any, "call_answered")) {
            await stateMachine.transition(enrollment.id, "call_answered", { outcome });
          }
          await stateMachine.transition(enrollment.id, "exhausted", { outcome });
        } else if (
          outcome === "no_answer" ||
          outcome === "voicemail" ||
          !outcome
        ) {
          // Connected but no booking — continue sequence via SMS
          if (stateMachine.canTransition(st as any, "call_no_answer")) {
            await stateMachine.transition(enrollment.id, "call_no_answer", {
              outcome: outcome ?? "no_answer",
            });
            const jobId = await enqueueJob("SEND_SMS", enrollment.id, waitSmsMs);
            await storeEnrollmentJobId(enrollment.id, jobId);
          }
        }

        // Increment workspace minute usage
        if (callDuration > 0) {
          await db
            .update(workspaces)
            .set({
              monthlyMinutesUsed: sql`${workspaces.monthlyMinutesUsed} + ${Math.ceil(callDuration / 60)}`,
              updatedAt: new Date(),
            })
            .where(eq(workspaces.id, enrollment.workspaceId));
        }
      }
    }

    res.sendStatus(200);
  } catch (err: any) {
    console.error(`Call status webhook error for session ${sessionId}:`, err.message);
    res.sendStatus(200); // Always 200 to Twilio — never retry on our errors
  }
});

// ─── POST /api/call/recording/:sessionId ─────────────────────────────────────
// Twilio recording ready callback — download + persist locally, store our URL.

router.post("/api/call/recording/:sessionId", validateTwilioCallSession, async (req: Request, res: Response) => {
  const sessionId    = req.params.sessionId as string;
  const recordingUrl = req.body.RecordingUrl as string;

  try {
    if (!recordingUrl) return res.sendStatus(200);

    const [session] = await db
      .select()
      .from(sdrCallSessions)
      .where(eq(sdrCallSessions.id, sessionId));

    // Resolve Twilio credentials for authenticated media download
    let accountSid =
      process.env.TWILIO_MASTER_SID || process.env.TWILIO_ACCOUNT_SID || "";
    let authToken =
      process.env.TWILIO_MASTER_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN || "";

    if (session) {
      const [workspace] = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, session.workspaceId));

      if (workspace?.twilioSubAccountSid && workspace?.twilioSubAuthToken) {
        try {
          accountSid = decrypt(workspace.twilioSubAccountSid);
          authToken  = decrypt(workspace.twilioSubAuthToken);
        } catch {
          // fall back to master env creds
        }
      }
    }

    let storedUrl = recordingUrl;
    if (accountSid && authToken) {
      const result = await persistTwilioRecording({
        sessionId,
        twilioRecordingUrl: recordingUrl,
        accountSid,
        authToken,
      });
      storedUrl = result.storedUrl;
    }

    await db
      .update(sdrCallSessions)
      .set({ recordingUrl: storedUrl })
      .where(eq(sdrCallSessions.id, sessionId));

    res.sendStatus(200);
  } catch (err: any) {
    console.error(`Recording webhook error for session ${sessionId}:`, err.message);
    // Still stash the raw Twilio URL so playback isn't totally lost
    try {
      if (recordingUrl) {
        await db
          .update(sdrCallSessions)
          .set({ recordingUrl })
          .where(eq(sdrCallSessions.id, sessionId));
      }
    } catch { /* ignore */ }
    res.sendStatus(200);
  }
});

// ─── GET /api/call/recordings/:sessionId ─────────────────────────────────────
// Stream a persisted recording (Supabase S3 or local). Session UUIDs act as the
// capability URL so <audio src> works without Authorization headers.

router.get("/api/call/recordings/:sessionId", async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string;
    const recording = await openRecordingStream(sessionId);
    if (!recording) return res.status(404).json({ error: "Recording not found" });

    res.setHeader("Content-Type", recording.contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    recording.stream.pipe(res);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AUTHENTICATED ROUTES (JWT + workspace scope) ─────────────────────────────

router.use("/api/call", requireAuth, workspaceScope);

// ─── GET /api/call/sessions ───────────────────────────────────────────────────
// Paginated call session history for the workspace.

router.get("/api/call/sessions", async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspace!.id;
    const page   = Math.max(1, parseInt(req.query.page  as string) || 1);
    const limit  = Math.min(100, parseInt(req.query.limit as string) || 20);
    const offset = (page - 1) * limit;

    // Alias leads table so we can join it twice:
    // 1. Via enrollmentId → sdrEnrollments → enrollmentLeads (SDR-sequence calls)
    // 2. Via sdrCallSessions.leadId → directLeads (manual calls from lead detail page)
    const enrollmentLeads = alias(leads, "enrollment_leads");
    const directLeads     = alias(leads, "direct_leads");

    const [sessions, [{ total }]] = await Promise.all([
      db
        .select({
          id:              sdrCallSessions.id,
          workspaceId:     sdrCallSessions.workspaceId,
          enrollmentId:    sdrCallSessions.enrollmentId,
          twilioCallSid:   sdrCallSessions.twilioCallSid,
          status:          sdrCallSessions.status,
          durationSeconds: sdrCallSessions.durationSeconds,
          recordingUrl:    sdrCallSessions.recordingUrl,
          transcript:      sdrCallSessions.transcript,
          aiSummary:       sdrCallSessions.aiSummary,
          outcome:         sdrCallSessions.outcome,
          startedAt:       sdrCallSessions.startedAt,
          endedAt:         sdrCallSessions.endedAt,
          // Prefer enrollment lead, fall back to direct leadId
          leadFirstName:   sql<string | null>`COALESCE(${enrollmentLeads.firstName}, ${directLeads.firstName})`,
          leadLastName:    sql<string | null>`COALESCE(${enrollmentLeads.lastName},  ${directLeads.lastName})`,
          leadPhone:       sql<string | null>`COALESCE(${enrollmentLeads.phone},     ${directLeads.phone})`,
        })
        .from(sdrCallSessions)
        .leftJoin(sdrEnrollments,  eq(sdrCallSessions.enrollmentId, sdrEnrollments.id))
        .leftJoin(enrollmentLeads, eq(sdrEnrollments.leadId, enrollmentLeads.id))
        .leftJoin(directLeads,     eq(sdrCallSessions.leadId, directLeads.id))
        .where(eq(sdrCallSessions.workspaceId, workspaceId))
        .orderBy(desc(sdrCallSessions.startedAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(sdrCallSessions)
        .where(eq(sdrCallSessions.workspaceId, workspaceId)),
    ]);

    res.json({
      data:  sessions.map(s => ({
        ...s,
        leadName: s.leadFirstName ? `${s.leadFirstName} ${s.leadLastName || ""}`.trim() : null,
      })),
      total: Number(total),
      page,
      limit,
      pages: Math.ceil(Number(total) / limit),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/call/sessions/:id ───────────────────────────────────────────────
// Single call session with transcript, recording URL, and AI summary.

router.get("/api/call/sessions/:id", async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspace!.id;

    const [session] = await db
      .select()
      .from(sdrCallSessions)
      .where(
        and(
          eq(sdrCallSessions.id, req.params.id as string),
          eq(sdrCallSessions.workspaceId, workspaceId)
        )
      );

    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/call/voices ─────────────────────────────────────────────────────
// Returns available ElevenLabs voices for the voice selector dropdown.

router.get("/api/call/voices", async (_req: Request, res: Response) => {
  try {
    const voices = await elevenlabs.listVoices();
    res.json(voices);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/call/analytics ──────────────────────────────────────────────────
// Call funnel metrics for the workspace.

router.get("/api/call/analytics", async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspace!.id;

    const outcomeCounts = await db
      .select({
        outcome: sdrCallSessions.outcome,
        total:   count(),
      })
      .from(sdrCallSessions)
      .where(eq(sdrCallSessions.workspaceId, workspaceId))
      .groupBy(sdrCallSessions.outcome);

    const byOutcome: Record<string, number> = {};
    let totalCalls = 0;
    for (const row of outcomeCounts) {
      const key = row.outcome ?? "unknown";
      byOutcome[key] = Number(row.total);
      totalCalls += Number(row.total);
    }

    const booked   = byOutcome["booked"]   ?? 0;
    const answered = (byOutcome["booked"] ?? 0) + (byOutcome["qualified"] ?? 0) + (byOutcome["answered"] ?? 0);

    // Average duration
    const [durationRow] = await db
      .select({ avg: sql<number>`AVG(duration_seconds)` })
      .from(sdrCallSessions)
      .where(
        and(
          eq(sdrCallSessions.workspaceId, workspaceId),
          eq(sdrCallSessions.status, "completed")
        )
      );

    res.json({
      totalCalls,
      answered,
      booked,
      answerRate: totalCalls > 0 ? Math.round((answered / totalCalls) * 100) : 0,
      bookingRate: answered > 0 ? Math.round((booked / answered) * 100) : 0,
      avgDurationSeconds: Math.round(durationRow?.avg ?? 0),
      byOutcome,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
