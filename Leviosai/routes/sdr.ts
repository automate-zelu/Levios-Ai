// ─── SDR ROUTES ───────────────────────────────────────────────────────────────
// All routes are scoped to the authenticated user's workspace.
// workspaceScope middleware injects req.workspace from JWT — tenants can never
// access another workspace's data.

import { Router, Request, Response } from "express";
import multer from "multer";
import { db } from "../lib/db.js";
import {
  sdrConfigs,
  sdrEnrollments,
  sdrLogs,
  sdrCallSessions,
  workspaces,
  leads,
  leadMessages,
} from "../lib/schema.js";
import { requireAuth } from "./auth.js";
import { workspaceScope } from "../middleware/workspaceScope.js";
import { enforceTierLimits } from "../middleware/tierEnforcement.js";
import { evaluateEnrollmentEligibility } from "../lib/sdr-eligibility.js";
import { buildWorkspaceVectorStore } from "../lib/calling/langchain-kb.js";
import { shouldRebuildKnowledgeBase, appendKnowledgeBaseDocuments } from "../lib/calling/kb-helpers.js";
import { extractKnowledgeBaseFile } from "../lib/calling/kb-extract.js";
import { SDR_TEMPLATE_VARS } from "../lib/sdr-template-vars.js";
import {
  eq,
  and,
  desc,
  sql,
  count,
} from "drizzle-orm";

const router = Router();
const kbUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 8 },
});

// All SDR routes require auth + workspace scope
router.use("/api/sdr", requireAuth, workspaceScope);

// ─── GET /api/sdr/template-vars ───────────────────────────────────────────────
// Variable catalog for SMS/email template editors (@-mention picker).
router.get("/api/sdr/template-vars", (_req: Request, res: Response) => {
  res.json({
    vars: SDR_TEMPLATE_VARS,
    note: "Insert with @ in the editor. Tokens are stored as {{key}}. New vars require CRM/workspace fields behind them.",
  });
});

// ─── GET /api/sdr/config ──────────────────────────────────────────────────────
// Returns the workspace's current SDR config (or null if not yet created).

router.get("/api/sdr/config", async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspace!.id;
    const [config] = await db
      .select()
      .from(sdrConfigs)
      .where(eq(sdrConfigs.workspaceId, workspaceId));

    res.json(config ?? null);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/sdr/config ──────────────────────────────────────────────────────
// Create or update SDR config for this workspace (upsert by workspaceId).

router.put("/api/sdr/config", async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspace!.id;
    const {
      systemPrompt,
      knowledgeBase,
      smsTemplate,
      emailSubject,
      emailBody,
      dormantDays,
      waitCallHrs,
      waitSmsHrs,
      reEnrollDays,
      assistantName,
      assistantVoiceId,
    } = req.body;

    if (!systemPrompt || !smsTemplate || !emailSubject || !emailBody) {
      return res.status(400).json({
        error: "systemPrompt, smsTemplate, emailSubject, and emailBody are required",
      });
    }

    const [existing] = await db
      .select({
        id: sdrConfigs.id,
        knowledgeBase: sdrConfigs.knowledgeBase,
        kbEmbeddedAt: sdrConfigs.kbEmbeddedAt,
      })
      .from(sdrConfigs)
      .where(eq(sdrConfigs.workspaceId, workspaceId));

    const values = {
      workspaceId,
      systemPrompt,
      knowledgeBase:    knowledgeBase    ?? null,
      smsTemplate,
      emailSubject,
      emailBody,
      dormantDays:      dormantDays      ?? 7,
      waitCallHrs:      waitCallHrs      ?? 2,
      waitSmsHrs:       waitSmsHrs       ?? 4,
      reEnrollDays:     reEnrollDays     ?? 30,
      assistantName:    assistantName    ?? null,
      assistantVoiceId: assistantVoiceId ?? null,
      updatedAt:        new Date(),
    };

    let config;
    if (existing) {
      [config] = await db
        .update(sdrConfigs)
        .set(values)
        .where(eq(sdrConfigs.id, existing.id))
        .returning();
    } else {
      [config] = await db
        .insert(sdrConfigs)
        .values(values)
        .returning();
    }

    // Module 9 — rebuild pgvector KB when knowledge base text changes (or first embed)
    const rebuild = shouldRebuildKnowledgeBase({
      previousKb: existing?.knowledgeBase,
      nextKb: values.knowledgeBase,
      kbEmbeddedAt: existing?.kbEmbeddedAt,
    });
    if (rebuild) {
      try {
        const result = await buildWorkspaceVectorStore(
          workspaceId,
          values.knowledgeBase ?? ""
        );
        (config as any).kbChunks = result.chunks;
      } catch (err: any) {
        console.error(`KB embed failed for workspace ${workspaceId}:`, err.message);
        // Config save still succeeds — KB can be rebuilt on next startup / retry
        (config as any).kbEmbedError = err.message;
      }
    }

    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/sdr/kb/upload ─────────────────────────────────────────────────
// Extract text from PDF/Word/text files and append to the workspace knowledge base.
router.post("/api/sdr/kb/upload", kbUpload.array("files", 8), async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspace!.id;
    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) return res.status(400).json({ error: "Choose at least one PDF, Word, or text file." });

    const blocks: string[] = [];
    const uploaded: string[] = [];
    for (const file of files) {
      const extracted = await extractKnowledgeBaseFile(file.originalname, file.buffer);
      blocks.push(extracted.block);
      uploaded.push(file.originalname);
    }

    const [existing] = await db
      .select()
      .from(sdrConfigs)
      .where(eq(sdrConfigs.workspaceId, workspaceId));

    const knowledgeBase = appendKnowledgeBaseDocuments(existing?.knowledgeBase, blocks);

    let config;
    if (existing) {
      [config] = await db
        .update(sdrConfigs)
        .set({ knowledgeBase, updatedAt: new Date() })
        .where(eq(sdrConfigs.id, existing.id))
        .returning();
    } else {
      [config] = await db
        .insert(sdrConfigs)
        .values({
          workspaceId,
          knowledgeBase,
          systemPrompt: "",
          smsTemplate: "",
          emailSubject: "",
          emailBody: "",
        } as any)
        .returning();
    }

    try {
      const result = await buildWorkspaceVectorStore(workspaceId, knowledgeBase);
      (config as any).kbChunks = result.chunks;
    } catch (err: any) {
      console.error(`KB embed after upload failed for ${workspaceId}:`, err.message);
      (config as any).kbEmbedError = err.message;
    }

    (config as any).uploaded = uploaded;
    res.json(config);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Could not read that file" });
  }
});

// ─── PATCH /api/sdr/config/voice ─────────────────────────────────────────────
// Update only the assistantVoiceId — called from the AI Calling voice picker.

router.patch("/api/sdr/config/voice", async (req: Request, res: Response) => {
  try {
    const workspaceId    = req.workspace!.id;
    const { assistantVoiceId } = req.body;
    if (!assistantVoiceId) return res.status(400).json({ error: "assistantVoiceId is required" });

    const [existing] = await db.select({ id: sdrConfigs.id }).from(sdrConfigs).where(eq(sdrConfigs.workspaceId, workspaceId));

    if (existing) {
      const [updated] = await db.update(sdrConfigs).set({ assistantVoiceId, updatedAt: new Date() }).where(eq(sdrConfigs.id, existing.id)).returning();
      res.json(updated);
    } else {
      // No config yet — create a minimal one (other fields can be filled in SDR Agent page)
      const [created] = await db.insert(sdrConfigs).values({ workspaceId, assistantVoiceId, systemPrompt: "", smsTemplate: "", emailSubject: "", emailBody: "" } as any).returning();
      res.json(created);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /api/sdr/config/status ────────────────────────────────────────────
// Toggle SDR active/inactive for this workspace.

router.patch("/api/sdr/config/status", async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspace!.id;
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      return res.status(400).json({ error: "isActive must be a boolean" });
    }

    const [config] = await db
      .update(sdrConfigs)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(sdrConfigs.workspaceId, workspaceId))
      .returning();

    if (!config) {
      return res.status(404).json({ error: "SDR config not found — create it first" });
    }

    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/sdr/enrollments ─────────────────────────────────────────────────
// List enrollments for this workspace (paginated). Optional filters: status, leadId.

router.get("/api/sdr/enrollments", async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspace!.id;
    const page   = Math.max(1, parseInt(req.query.page  as string) || 1);
    const limit  = Math.min(100, parseInt(req.query.limit as string) || 20);
    const offset = (page - 1) * limit;

    const conditions = [eq(sdrEnrollments.workspaceId, workspaceId)];

    if (req.query.status) {
      conditions.push(eq(sdrEnrollments.status, req.query.status as string));
    }
    if (req.query.leadId) {
      conditions.push(eq(sdrEnrollments.leadId, parseInt(req.query.leadId as string)));
    }

    const filter = and(...conditions);

    const [enrollmentRows, [{ total }]] = await Promise.all([
      db
        .select({
          id: sdrEnrollments.id,
          workspaceId: sdrEnrollments.workspaceId,
          leadId: sdrEnrollments.leadId,
          status: sdrEnrollments.status,
          currentStep: sdrEnrollments.currentStep,
          callAttempts: sdrEnrollments.callAttempts,
          enrolledAt: sdrEnrollments.enrolledAt,
          callInitiatedAt: sdrEnrollments.callInitiatedAt,
          smsSentAt: sdrEnrollments.smsSentAt,
          emailSentAt: sdrEnrollments.emailSentAt,
          exhaustedAt: sdrEnrollments.exhaustedAt,
          nextEnrollAfter: sdrEnrollments.nextEnrollAfter,
          callSessionId: sdrEnrollments.callSessionId,
          bullmqJobId: sdrEnrollments.bullmqJobId,
          createdAt: sdrEnrollments.createdAt,
          updatedAt: sdrEnrollments.updatedAt,
          leadFirstName: leads.firstName,
          leadLastName: leads.lastName,
          leadEmail: leads.email,
          leadPhone: leads.phone,
        })
        .from(sdrEnrollments)
        .leftJoin(leads, eq(sdrEnrollments.leadId, leads.id))
        .where(filter)
        .orderBy(desc(sdrEnrollments.enrolledAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(sdrEnrollments)
        .where(filter),
    ]);

    res.json({
      data:  enrollmentRows,
      total: Number(total),
      page,
      limit,
      pages: Math.ceil(Number(total) / limit),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/sdr/enrollments/:id ─────────────────────────────────────────────
// Single enrollment with its full step log.

router.get("/api/sdr/enrollments/:id", async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspace!.id;

    const [enrollment] = await db
      .select()
      .from(sdrEnrollments)
      .where(
        and(
          eq(sdrEnrollments.id, req.params.id as string),
          eq(sdrEnrollments.workspaceId, workspaceId)
        )
      );

    if (!enrollment) return res.status(404).json({ error: "Enrollment not found" });

    const [logs, [lead], callSessions, messages] = await Promise.all([
      db
        .select()
        .from(sdrLogs)
        .where(eq(sdrLogs.enrollmentId, enrollment.id))
        .orderBy(sdrLogs.loggedAt),
      db
        .select({
          id: leads.id,
          firstName: leads.firstName,
          lastName: leads.lastName,
          email: leads.email,
          phone: leads.phone,
        })
        .from(leads)
        .where(eq(leads.id, enrollment.leadId))
        .limit(1),
      db
        .select()
        .from(sdrCallSessions)
        .where(eq(sdrCallSessions.enrollmentId, enrollment.id))
        .orderBy(sdrCallSessions.startedAt),
      db
        .select()
        .from(leadMessages)
        .where(eq(leadMessages.leadId, enrollment.leadId))
        .orderBy(leadMessages.createdAt),
    ]);

    res.json({
      enrollment,
      lead: lead ?? null,
      logs,
      callSessions,
      messages,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/sdr/leads/:leadId/logs ─────────────────────────────────────────
// Full SDR timeline for a lead: logs + enrollment + messages + call sessions.

router.get("/api/sdr/leads/:leadId/logs", async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspace!.id;
    const leadId = parseInt(req.params.leadId as string);

    if (isNaN(leadId)) return res.status(400).json({ error: "Invalid leadId" });

    const logs = await db
      .select()
      .from(sdrLogs)
      .where(
        and(
          eq(sdrLogs.workspaceId, workspaceId),
          eq(sdrLogs.leadId, leadId)
        )
      )
      .orderBy(sdrLogs.loggedAt);

    // All enrollment cycles for this lead (each try is its own sequence)
    const enrollments = await db
      .select()
      .from(sdrEnrollments)
      .where(
        and(
          eq(sdrEnrollments.workspaceId, workspaceId),
          eq(sdrEnrollments.leadId, leadId)
        )
      )
      .orderBy(desc(sdrEnrollments.enrolledAt));

    const [messages, callSessions] = await Promise.all([
      db
        .select()
        .from(leadMessages)
        .where(eq(leadMessages.leadId, leadId))
        .orderBy(leadMessages.createdAt),
      db
        .select()
        .from(sdrCallSessions)
        .where(
          and(
            eq(sdrCallSessions.workspaceId, workspaceId),
            eq(sdrCallSessions.leadId, leadId)
          )
        )
        .orderBy(sdrCallSessions.startedAt),
    ]);

    res.json({
      logs,
      enrollment: enrollments[0] ?? null,
      enrollments,
      messages,
      callSessions,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/sdr/analytics ───────────────────────────────────────────────────
// Enrollment funnel metrics for this workspace.

router.get("/api/sdr/analytics", async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspace!.id;

    // Load workspace for usage bars
    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));

    // Count enrollments by status
    const statusCounts = await db
      .select({
        status: sdrEnrollments.status,
        total:  count(),
      })
      .from(sdrEnrollments)
      .where(eq(sdrEnrollments.workspaceId, workspaceId))
      .groupBy(sdrEnrollments.status);

    const byStatus: Record<string, number> = {};
    for (const row of statusCounts) {
      byStatus[row.status] = Number(row.total);
    }

    const totalEnrollments = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const booked    = byStatus["booked"]    ?? 0;
    const exhausted = byStatus["exhausted"] ?? 0;

    res.json({
      totalEnrollments,
      booked,
      exhausted,
      active: totalEnrollments - booked - exhausted,
      bookedRate:    totalEnrollments > 0 ? Math.round((booked / totalEnrollments) * 100) : 0,
      exhaustedRate: totalEnrollments > 0 ? Math.round((exhausted / totalEnrollments) * 100) : 0,
      byStatus,
      usage: workspace
        ? {
            leadsUsed:    workspace.monthlyLeadsUsed,
            minutesUsed:  workspace.monthlyMinutesUsed,
            testMinutesUsed: ((workspace as any).monthlyTestMinutesUsed ?? 0) / 60,
            testSecondsUsed: (workspace as any).monthlyTestMinutesUsed ?? 0,
          }
        : null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/sdr/enroll/:leadId ─────────────────────────────────────────────
// Manually enroll a lead into the SDR sequence (admin/testing override).
// Manual enroll. Inactive workspaces are blocked via enforceTierLimits.
// Re-enroll gate / booked / opt-out validated via sdr-eligibility (Module 7).

router.post(
  "/api/sdr/enroll/:leadId",
  enforceTierLimits,
  async (req: Request, res: Response) => {
    try {
      const workspaceId = req.workspace!.id;
      const leadId = parseInt(req.params.leadId as string);

      if (isNaN(leadId)) return res.status(400).json({ error: "Invalid leadId" });

      const [lead] = await db
        .select()
        .from(leads)
        .where(
          and(
            eq(leads.id, leadId),
            eq(leads.organizationId, req.organizationId!)
          )
        );

      if (!lead) return res.status(404).json({ error: "Lead not found" });

      const [workspace] = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId));

      if (!workspace) return res.status(404).json({ error: "Workspace not found" });

      const [latestEnrollment] = await db
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

      const decision = evaluateEnrollmentEligibility({
        lead: {
          status: lead.status,
          consentStatus: lead.consentStatus,
          dncClean: lead.dncClean,
          lastContactedAt: lead.lastContactedAt,
        },
        latestEnrollment: latestEnrollment ?? null,
        workspace: {
          isActive: workspace.isActive,
          monthlyLeadsUsed: workspace.monthlyLeadsUsed,
          monthlyLeadLimit: workspace.monthlyLeadLimit,
        },
        requireDormant: false, // manual enroll may override dormancy
      });

      if (!decision.ok) {
        const statusByReason: Record<string, number> = {
          active_enrollment: 409,
          booked: 409,
          reenroll_gate: 409,
          closed_lead: 400,
          opted_out: 403,
          dnc: 403,
          lead_limit: 429,
          workspace_inactive: 403,
        };
        return res.status(statusByReason[decision.reason] ?? 400).json({
          error: `Enrollment not allowed: ${decision.reason}`,
          reason: decision.reason,
          enrollmentId: latestEnrollment?.id,
          status: latestEnrollment?.status,
          nextEnrollAfter: latestEnrollment?.nextEnrollAfter ?? null,
        });
      }

      let enrollment;
      let mode = decision.mode;
      let jobId: string | null = null;

      if (decision.mode === "reenroll") {
        // Close out prior cycle: leave exhausted row as historical archive,
        // start a brand-new enrollment so logs/stats don't mix.
        const { startFreshEnrollment } = await import("../lib/sdr-start-enrollment.js");
        const started = await startFreshEnrollment({
          workspaceId,
          leadId,
          priorEnrollmentId: decision.enrollmentId,
          reason: "manual_reenroll",
        });
        enrollment = started.enrollment;
        jobId = started.jobId;
      } else {
        const { startFreshEnrollment } = await import("../lib/sdr-start-enrollment.js");
        const started = await startFreshEnrollment({
          workspaceId,
          leadId,
          reason: "manual_enroll",
        });
        enrollment = started.enrollment;
        jobId = started.jobId;
      }

      await db
        .update(workspaces)
        .set({
          monthlyLeadsUsed: sql`${workspaces.monthlyLeadsUsed} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(workspaces.id, workspaceId));

      res.status(201).json({ enrollment, jobId, mode });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── GET /api/sdr/test-credits ────────────────────────────────────────────────

router.get("/api/sdr/test-credits", async (req: Request, res: Response) => {
  try {
    const { readTestCreditSnapshot } = await import("../lib/test-credits-apply.js");
    const credits = await readTestCreditSnapshot(req.workspace!.id);
    if (!credits) return res.status(404).json({ error: "Workspace not found" });
    res.json(credits);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/sdr/voice-stack", async (req: Request, res: Response) => {
  try {
    const { buildAgentStack } = await import("../lib/agent-stack.js");
    const { ensureTestCreditColumn } = await import("../lib/schema-ensure.js");
    await ensureTestCreditColumn();
    const workspaceId = req.workspace!.id;
    const [config] = await db.select().from(sdrConfigs).where(eq(sdrConfigs.workspaceId, workspaceId));
    let voices: Array<{ id: string; name: string }> = [];
    try {
      const { ElevenLabsClient } = await import("../lib/calling/elevenlabs-client.js");
      voices = (await new ElevenLabsClient().listVoices()).map((v) => ({ id: v.id, name: v.name }));
    } catch {
      voices = [];
    }
    const voiceId = config?.assistantVoiceId || null;
    const voiceName = voices.find((v) => v.id === voiceId)?.name || null;
    res.json(
      buildAgentStack({
        workspaceId,
        sttModel: (config as any)?.sttModel,
        llmModel: (config as any)?.llmModel,
        ttsModel: (config as any)?.ttsModel,
        voiceId,
        voiceName,
        voices,
      })
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/sdr/voice-stack", async (req: Request, res: Response) => {
  try {
    const { ensureTestCreditColumn } = await import("../lib/schema-ensure.js");
    const {
      resolveSttModel,
      resolveLlmModel,
      resolveTtsModel,
      buildAgentStack,
    } = await import("../lib/agent-stack.js");
    await ensureTestCreditColumn();
    const workspaceId = req.workspace!.id;
    const sttModel = resolveSttModel(req.body?.sttModel);
    const llmModel = resolveLlmModel(req.body?.llmModel);
    const ttsModel = resolveTtsModel(req.body?.ttsModel);
    const assistantVoiceId =
      typeof req.body?.assistantVoiceId === "string" && req.body.assistantVoiceId.trim()
        ? req.body.assistantVoiceId.trim()
        : undefined;

    const [existing] = await db.select({ id: sdrConfigs.id }).from(sdrConfigs).where(eq(sdrConfigs.workspaceId, workspaceId));
    if (!existing) {
      return res.status(400).json({ error: "Save SDR Agent configuration before choosing stack models" });
    }
    await db
      .update(sdrConfigs)
      .set({
        sttModel,
        llmModel,
        ttsModel,
        ...(assistantVoiceId ? { assistantVoiceId } : {}),
        updatedAt: new Date(),
      } as any)
      .where(eq(sdrConfigs.id, existing.id));

    const [config] = await db.select().from(sdrConfigs).where(eq(sdrConfigs.workspaceId, workspaceId));
    let voices: Array<{ id: string; name: string }> = [];
    try {
      const { ElevenLabsClient } = await import("../lib/calling/elevenlabs-client.js");
      voices = (await new ElevenLabsClient().listVoices()).map((v) => ({ id: v.id, name: v.name }));
    } catch {
      voices = [];
    }
    const voiceId = config?.assistantVoiceId || null;
    res.json(
      buildAgentStack({
        workspaceId,
        sttModel: (config as any)?.sttModel,
        llmModel: (config as any)?.llmModel,
        ttsModel: (config as any)?.ttsModel,
        voiceId,
        voiceName: voices.find((v) => v.id === voiceId)?.name || null,
        voices,
      })
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/sdr/test-call ──────────────────────────────────────────────────
// Start an in-browser rehearsal (no Twilio). Prompt can be unsaved draft.

router.post("/api/sdr/test-call", async (req: Request, res: Response) => {
  try {
    const { createBrowserTestCall } = await import("../lib/calling/browser-test-session.js");
    const { browserTestWsPath } = await import("../lib/calling/browser-test-protocol.js");
    if (!req.workspace?.id || !req.organizationId) {
      return res.status(400).json({ error: "No workspace" });
    }
    const systemPrompt = String(req.body?.systemPrompt || "").trim();
    if (!systemPrompt) {
      return res.status(400).json({ error: "Save or enter a system prompt before testing" });
    }
    const { readTestCreditSnapshot } = await import("../lib/test-credits-apply.js");
    const { decideTestCallStart, sessionBudgetSeconds } = await import("../lib/test-credits.js");
    const credits = await readTestCreditSnapshot(req.workspace.id);
    const allowPaid = req.body?.allowPaid === true;
    if (credits) {
      const decision = decideTestCallStart({ snapshot: credits, allowPaid });
      if (!decision.start) {
        return res.status(decision.reason === "blocked" ? 402 : 403).json({
          error: decision.message,
          reason: decision.reason,
          credits,
        });
      }
    }
    const budget = credits
      ? sessionBudgetSeconds({
          testRemainingSeconds: credits.testRemainingSeconds,
          paidRemainingSeconds: credits.paidRemainingSeconds,
          allowPaid,
        })
      : sessionBudgetSeconds({ testRemainingSeconds: 0, paidRemainingSeconds: 0, allowPaid: false });
    if (budget.budgetSeconds <= 0) {
      return res.status(402).json({
        error: "No minutes left for this rehearsal.",
        reason: "blocked",
        credits,
      });
    }
    const [cfg] = await db
      .select()
      .from(sdrConfigs)
      .where(eq(sdrConfigs.workspaceId, req.workspace.id));
    const { sessionId } = createBrowserTestCall({
      workspaceId: req.workspace.id,
      organizationId: req.organizationId,
      systemPrompt,
      assistantName: req.body?.assistantName || cfg?.assistantName || null,
      assistantVoiceId: req.body?.assistantVoiceId || cfg?.assistantVoiceId || null,
      sttModel: (cfg as any)?.sttModel || null,
      llmModel: (cfg as any)?.llmModel || null,
      ttsModel: (cfg as any)?.ttsModel || null,
      allowPaid,
      budgetSeconds: budget.budgetSeconds,
    });
    res.status(201).json({
      sessionId,
      path: browserTestWsPath(sessionId),
      credits,
      budgetSeconds: budget.budgetSeconds,
      budgetMinutes: budget.budgetMinutes,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
