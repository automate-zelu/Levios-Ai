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
//   GET  /api/call/live                — Active/live calls for workspace monitor
//   GET  /api/call/live/:sessionId     — Live transcript snapshot (structured lines)
//   GET  /api/call/live/:sessionId/events — SSE stream of live transcript updates

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
  sdrLogs,
  leadMessages,
  appointments,
} from "../lib/schema.js";
import {
  stateMachine,
  MAX_CALL_ATTEMPTS,
  BUSY_RETRY_DELAY_MS,
} from "../lib/sdr-state-machine.js";
import { enqueueJob, fallThroughToSms, storeEnrollmentJobId } from "../lib/sdr-queue.js";
import { shouldRetryBusyCall, billableCallMinutes } from "../lib/sdr-m1-logic.js";
import { AudioPipeline, abortCallPipeline } from "../lib/calling/audio-pipeline.js";
import { ElevenLabsClient } from "../lib/calling/elevenlabs-client.js";
import { persistTwilioRecording, openRecordingStream } from "../lib/calling/recording-storage.js";
import { decrypt } from "../lib/crypto.js";
import { requireAuth } from "./auth.js";
import { workspaceScope } from "../middleware/workspaceScope.js";
import { validateTwilioCallSession } from "../middleware/twilioSignature.js";
import { eq, and, desc, asc, count, sql, gte, lte, ne, or, isNull, inArray } from "drizzle-orm";
import { liveCallRegistry, parseStoredTranscript } from "../lib/calling/live-call-registry.js";
import { alias } from "drizzle-orm/pg-core";
import { bookAppointmentWithCalendar } from "../lib/calendar/service.js";
import { parseScheduledAt } from "../lib/calendar/booking-helpers.js";
import { ensureAppointmentCalendarColumns } from "../lib/calendar/schema-ensure.js";
import { transcriptHasLeadSpeech } from "../lib/calling/pipeline-helpers.js";

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

  // Twilio fetches this TwiML when the far end "answers" — including voicemail.
  // Do NOT mark call_connected here. That waits until the lead actually speaks.

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
        .set({ status: "completed", outcome: "no_answer", durationSeconds: callDuration || 0, endedAt: new Date() })
        .where(and(eq(sdrCallSessions.id, sessionId), sql`status != 'completed'`));
    } else if (callStatus === "failed") {
      await db.update(sdrCallSessions)
        .set({ status: "completed", outcome: "failed", durationSeconds: callDuration || 0, endedAt: new Date() })
        .where(and(eq(sdrCallSessions.id, sessionId), sql`status != 'completed'`));
    } else if (callStatus === "busy") {
      await db.update(sdrCallSessions)
        .set({ status: "completed", outcome: "busy", durationSeconds: callDuration || 0, endedAt: new Date() })
        .where(and(eq(sdrCallSessions.id, sessionId), sql`status != 'completed'`));
    } else if (callStatus === "completed") {
      // Set duration + ensure status=completed (audio-pipeline may have already done this)
      await db.update(sdrCallSessions)
        .set({ durationSeconds: callDuration, status: "completed", endedAt: new Date() })
        .where(eq(sdrCallSessions.id, sessionId));
    }

    // Drop from Live Calls monitor when Twilio reports a terminal status
    if (["completed", "no-answer", "busy", "failed", "canceled"].includes(callStatus)) {
      liveCallRegistry.end(sessionId, "completed");
      abortCallPipeline(sessionId);
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
        const leadSpoke = transcriptHasLeadSpeech(
          updatedSession?.transcript || session.transcript
        );

        if (outcome === "booked" && leadSpoke) {
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
                const windowStart = new Date(scheduledAt.getTime() - 60_000);
                const windowEnd = new Date(scheduledAt.getTime() + 60_000);
                const [dup] = await db
                  .select({ id: appointments.id })
                  .from(appointments)
                  .where(
                    and(
                      eq(appointments.leadId, session.leadId),
                      gte(appointments.scheduledAt, windowStart),
                      lte(appointments.scheduledAt, windowEnd)
                    )
                  )
                  .limit(1);

                if (dup) {
                  console.log(
                    `Calendar booking skipped for session ${sessionId} — appointment ${dup.id} already exists`
                  );
                } else {
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
            }
          } catch (bookErr: any) {
            console.warn(`Appointment booking after call failed: ${bookErr.message}`);
          }
        } else if ((outcome === "qualified" || outcome === "answered") && leadSpoke) {
          if (st === "call_initiated" && stateMachine.canTransition("call_initiated", "call_connected")) {
            await stateMachine.transition(enrollment.id, "call_connected", { outcome });
          }
          const [mid] = await db.select().from(sdrEnrollments).where(eq(sdrEnrollments.id, enrollment.id));
          if (mid && stateMachine.canTransition(mid.status as any, "call_answered")) {
            await stateMachine.transition(enrollment.id, "call_answered", { outcome });
          }
          await stateMachine.transition(enrollment.id, "exhausted", { outcome });
        } else {
          // Missed, voicemail, or greeting-only — continue sequence via SMS
          if (stateMachine.canTransition(st as any, "call_no_answer")) {
            await stateMachine.transition(enrollment.id, "call_no_answer", {
              outcome: leadSpoke ? (outcome ?? "no_answer") : "no_answer",
            });
            const jobId = await enqueueJob("SEND_SMS", enrollment.id, waitSmsMs);
            await storeEnrollmentJobId(enrollment.id, jobId);
          }
        }

        // Increment workspace usage for answered conversations, by the second.
        const [sessionForBill] = await db
          .select({ outcome: sdrCallSessions.outcome, durationSeconds: sdrCallSessions.durationSeconds })
          .from(sdrCallSessions)
          .where(eq(sdrCallSessions.id, sessionId));

        const minutes = billableCallMinutes(sessionForBill?.durationSeconds ?? callDuration, {
          callStatus,
          outcome: sessionForBill?.outcome,
        });

        if (minutes > 0) {
          await db
            .update(workspaces)
            .set({
              monthlyMinutesUsed: sql`${workspaces.monthlyMinutesUsed} + ${minutes}`,
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

// ─── GET /api/call/live ───────────────────────────────────────────────────────
// Truly live calls only: in-memory registry (streaming) OR freshly ringing (<2 min).

router.get("/api/call/live", async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspace!.id;
    const liveMem = liveCallRegistry.listByWorkspace(workspaceId);
    const liveIds = new Set(liveMem.map((s) => s.sessionId));

    const enrollmentLeads = alias(leads, "live_enrollment_leads");
    const directLeads = alias(leads, "live_direct_leads");

    // Ringing grace window — before Twilio media stream registers in memory
    const ringingCut = new Date(Date.now() - 2 * 60 * 1000);
    const idsToLoad = [...liveIds];

    const liveOrRinging = idsToLoad.length
      ? or(
          inArray(sdrCallSessions.id, idsToLoad),
          and(
            inArray(sdrCallSessions.status, ["initiated", "active"]),
            gte(sdrCallSessions.startedAt, ringingCut)
          )
        )
      : and(
          inArray(sdrCallSessions.status, ["initiated", "active"]),
          gte(sdrCallSessions.startedAt, ringingCut)
        );

    const dbRows = await db
      .select({
        id: sdrCallSessions.id,
        status: sdrCallSessions.status,
        outcome: sdrCallSessions.outcome,
        twilioCallSid: sdrCallSessions.twilioCallSid,
        startedAt: sdrCallSessions.startedAt,
        endedAt: sdrCallSessions.endedAt,
        transcript: sdrCallSessions.transcript,
        leadFirstName: sql<string | null>`COALESCE(${enrollmentLeads.firstName}, ${directLeads.firstName})`,
        leadLastName: sql<string | null>`COALESCE(${enrollmentLeads.lastName}, ${directLeads.lastName})`,
        leadPhone: sql<string | null>`COALESCE(${enrollmentLeads.phone}, ${directLeads.phone})`,
      })
      .from(sdrCallSessions)
      .leftJoin(sdrEnrollments, eq(sdrCallSessions.enrollmentId, sdrEnrollments.id))
      .leftJoin(enrollmentLeads, eq(sdrEnrollments.leadId, enrollmentLeads.id))
      .leftJoin(directLeads, eq(sdrCallSessions.leadId, directLeads.id))
      .where(
        and(
          eq(sdrCallSessions.workspaceId, workspaceId),
          isNull(sdrCallSessions.endedAt),
          liveOrRinging
        )
      )
      .orderBy(desc(sdrCallSessions.startedAt))
      .limit(30);

    const byId = new Map<string, any>();

    for (const row of dbRows) {
      const mem = liveMem.find((m) => m.sessionId === row.id);
      const isLive = liveIds.has(row.id);
      // Drop DB "active/initiated" that aren't in registry and older than grace — already filtered
      const lines = mem?.lines?.length
        ? mem.lines
        : parseStoredTranscript(row.transcript);
      const status = mem?.status || (isLive ? "active" : row.status) || "initiated";
      byId.set(row.id, {
        id: row.id,
        status,
        outcome: row.outcome,
        twilioCallSid: row.twilioCallSid,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        live: isLive || status === "active",
        lineCount: lines.length,
        preview: lines.slice(-1)[0] || null,
        leadName: row.leadFirstName
          ? `${row.leadFirstName} ${row.leadLastName || ""}`.trim()
          : null,
        leadPhone: row.leadPhone,
      });
    }

    for (const mem of liveMem) {
      if (byId.has(mem.sessionId)) continue;
      byId.set(mem.sessionId, {
        id: mem.sessionId,
        status: mem.status,
        outcome: null,
        twilioCallSid: null,
        startedAt: new Date(mem.startedAt).toISOString(),
        endedAt: null,
        live: true,
        lineCount: mem.lines.length,
        preview: mem.lines.slice(-1)[0] || null,
        leadName: null,
        leadPhone: null,
      });
    }

    const calls = [...byId.values()].sort((a, b) => {
      const ta = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const tb = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return tb - ta;
    });

    res.json({ data: calls, total: calls.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/call/live/:sessionId ────────────────────────────────────────────
// Snapshot of live (or just-finished) structured transcript lines.

router.get("/api/call/live/:sessionId", async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspace!.id;
    const sessionId = req.params.sessionId as string;

    const [session] = await db
      .select()
      .from(sdrCallSessions)
      .where(
        and(eq(sdrCallSessions.id, sessionId), eq(sdrCallSessions.workspaceId, workspaceId))
      );

    if (!session) return res.status(404).json({ error: "Session not found" });

    const mem = liveCallRegistry.get(sessionId);
    const lines = mem?.lines?.length
      ? mem.lines
      : parseStoredTranscript(session.transcript);

    let leadName: string | null = null;
    let leadPhone: string | null = null;
    if (session.leadId) {
      const [lead] = await db
        .select({
          firstName: leads.firstName,
          lastName: leads.lastName,
          phone: leads.phone,
        })
        .from(leads)
        .where(eq(leads.id, session.leadId))
        .limit(1);
      if (lead) {
        leadName = `${lead.firstName || ""} ${lead.lastName || ""}`.trim() || null;
        leadPhone = lead.phone;
      }
    }

    res.json({
      id: session.id,
      status: mem?.status || session.status,
      outcome: session.outcome,
      live: !!mem,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      leadName,
      leadPhone,
      lines,
      aiSummary: session.aiSummary,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/call/live/:sessionId/events ─────────────────────────────────────
// Server-Sent Events stream of transcript updates (Authorization: Bearer …).

router.get("/api/call/live/:sessionId/events", async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspace!.id;
    const sessionId = req.params.sessionId as string;

    const [session] = await db
      .select({ id: sdrCallSessions.id, workspaceId: sdrCallSessions.workspaceId, transcript: sdrCallSessions.transcript, status: sdrCallSessions.status })
      .from(sdrCallSessions)
      .where(
        and(eq(sdrCallSessions.id, sessionId), eq(sdrCallSessions.workspaceId, workspaceId))
      );

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (payload: unknown) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const mem = liveCallRegistry.get(sessionId);
    if (!mem) {
      const lines = parseStoredTranscript(session.transcript);
      send({ type: "snapshot", sessionId, status: session.status || "completed", lines });
      send({ type: "ended", sessionId, status: session.status || "completed", lines });
      res.end();
      return;
    }

    const unsub = liveCallRegistry.subscribe(sessionId, (event) => {
      send(event);
      if (event.type === "ended") {
        unsub();
        res.end();
      }
    });

    const heartbeat = setInterval(() => {
      res.write(`: ping\n\n`);
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
      unsub();
    });
  } catch (err: any) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});

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
// Single call session with transcript, recording, and dial-scoped SDR flow.

router.get("/api/call/sessions/:id", async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspace!.id;
    const sessionId = req.params.id as string;

    const [session] = await db
      .select()
      .from(sdrCallSessions)
      .where(
        and(
          eq(sdrCallSessions.id, sessionId),
          eq(sdrCallSessions.workspaceId, workspaceId)
        )
      );

    if (!session) return res.status(404).json({ error: "Session not found" });

    let lead: {
      id: number;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      phone: string | null;
    } | null = null;

    if (session.leadId) {
      const [row] = await db
        .select({
          id: leads.id,
          firstName: leads.firstName,
          lastName: leads.lastName,
          email: leads.email,
          phone: leads.phone,
        })
        .from(leads)
        .where(eq(leads.id, session.leadId))
        .limit(1);
      lead = row ?? null;
    }

    let logs: any[] = [];
    let messages: any[] = [];
    let enrollment: any = null;

    if (session.enrollmentId) {
      const [enr] = await db
        .select()
        .from(sdrEnrollments)
        .where(eq(sdrEnrollments.id, session.enrollmentId));
      enrollment = enr ?? null;

      const allLogs = await db
        .select()
        .from(sdrLogs)
        .where(eq(sdrLogs.enrollmentId, session.enrollmentId))
        .orderBy(asc(sdrLogs.loggedAt));

      const startIdx = allLogs.findIndex(
        (l) =>
          l.stepName === "call_initiated" &&
          (l.payload as any)?.sessionId === session.id
      );

      let dialLogs = allLogs;
      if (startIdx >= 0) {
        let endIdx = allLogs.length;
        for (let i = startIdx + 1; i < allLogs.length; i++) {
          if (
            allLogs[i].stepName === "call_initiated" ||
            allLogs[i].stepName === "re_enrolled"
          ) {
            endIdx = i;
            break;
          }
        }
        dialLogs = allLogs.slice(startIdx, endIdx);
      } else {
        const t0 = session.startedAt ? new Date(session.startedAt).getTime() : 0;
        const t1 = session.endedAt
          ? new Date(session.endedAt).getTime() + 6 * 60 * 60 * 1000
          : Date.now();
        dialLogs = allLogs.filter((l) => {
          if ((l.payload as any)?.sessionId === session.id) return true;
          const t = new Date(l.loggedAt).getTime();
          return (
            t >= t0 &&
            t <= t1 &&
            !["re_enrolled", "stuck_recovery"].includes(l.stepName)
          );
        });
      }
      logs = dialLogs.filter((l) => l.stepName !== "stuck_recovery");

      if (session.leadId) {
        const startAt = dialLogs[0]?.loggedAt
          ? new Date(dialLogs[0].loggedAt).getTime() - 5_000
          : session.startedAt
            ? new Date(session.startedAt).getTime() - 5_000
            : 0;
        const endAt = dialLogs[dialLogs.length - 1]?.loggedAt
          ? new Date(dialLogs[dialLogs.length - 1].loggedAt).getTime() + 60_000
          : session.endedAt
            ? new Date(session.endedAt).getTime() + 6 * 60 * 60 * 1000
            : Date.now();

        const allMsgs = await db
          .select()
          .from(leadMessages)
          .where(eq(leadMessages.leadId, session.leadId))
          .orderBy(asc(leadMessages.createdAt));

        messages = allMsgs.filter((m) => {
          const t = new Date(m.createdAt).getTime();
          return t >= startAt && t <= endAt;
        });
      }
    }

    const leadName = lead
      ? [lead.firstName, lead.lastName].filter(Boolean).join(" ")
      : null;

    res.json({
      session: {
        ...session,
        leadName,
        leadPhone: lead?.phone ?? null,
        leadEmail: lead?.email ?? null,
      },
      lead,
      enrollment: enrollment
        ? {
            id: enrollment.id,
            status: enrollment.status,
            callAttempts: enrollment.callAttempts,
            enrolledAt: enrollment.enrolledAt,
          }
        : null,
      logs,
      messages,
      callSessions: [session],
    });
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

router.get("/api/call/voices/:voiceId", async (req: Request, res: Response) => {
  try {
    const voiceId = String(req.params.voiceId || "").trim();
    if (!voiceId) return res.status(400).json({ error: "voiceId is required" });
    const voice = await elevenlabs.getVoice(voiceId);
    if (!voice) return res.status(404).json({ error: "Voice not found for that ID. Check ElevenLabs and that the key can access it." });
    res.json(voice);
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
