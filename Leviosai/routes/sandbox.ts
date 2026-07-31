// ─── SANDBOX API ROUTES ─────────────────────────────────────────────────────
// Demo endpoints for testing the Reactor's conversational SMS flow
// without Twilio, database, or any external dependencies.
// All state is in-memory — perfect for demos and testing.

import { Router, Request, Response } from "express";
import {
  createSession,
  getSession,
  listSessions,
  deleteSession,
  sendOutbound,
  processReply,
  DEMO_SCENARIOS,
} from "../reactor/sandbox.js";
import { storage } from "../lib/storage.js";

const router = Router();

// ─── List available demo scenarios ──────────────────────────────────────────
router.get("/api/sandbox/scenarios", (_req: Request, res: Response) => {
  const scenarios = Object.entries(DEMO_SCENARIOS).map(([key, scenario]) => ({
    id: key,
    name: scenario.name,
    description: scenario.description,
    replyCount: scenario.replies.length,
  }));
  res.json({ scenarios });
});

// ─── Create a new sandbox session ───────────────────────────────────────────
router.post("/api/sandbox/sessions", (req: Request, res: Response) => {
  const { scenarioId, lead } = req.body;

  let overrides = lead;
  if (scenarioId && DEMO_SCENARIOS[scenarioId as keyof typeof DEMO_SCENARIOS]) {
    overrides = DEMO_SCENARIOS[scenarioId as keyof typeof DEMO_SCENARIOS].leadOverrides;
  }

  const session = createSession(overrides);
  res.json({
    session: formatSession(session),
    hint: "POST /api/sandbox/sessions/:id/outbound to send the first message",
  });
});

// ─── List active sessions ───────────────────────────────────────────────────
router.get("/api/sandbox/sessions", (_req: Request, res: Response) => {
  const sessions = listSessions().map(formatSession);
  res.json({ sessions, count: sessions.length });
});

// ─── Get session details ────────────────────────────────────────────────────
router.get("/api/sandbox/sessions/:id", (req: Request, res: Response) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json({ session: formatSession(session) });
});

// ─── Delete a session ───────────────────────────────────────────────────────
router.delete("/api/sandbox/sessions/:id", (req: Request, res: Response) => {
  const deleted = deleteSession(req.params.id);
  res.json({ deleted });
});

// ─── Send outbound SMS (AI generates the message) ───────────────────────────
router.post("/api/sandbox/sessions/:id/outbound", async (req: Request, res: Response) => {
  try {
    const result = await sendOutbound(req.params.id);
    const session = getSession(req.params.id)!;

    res.json({
      message: result.message,
      events: result.events,
      lead: session.lead,
      conversationLength: session.messages.length,
      hint: "POST /api/sandbox/sessions/:id/reply with { \"text\": \"...\" } to simulate a lead response",
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ─── Simulate inbound reply from lead ───────────────────────────────────────
router.post("/api/sandbox/sessions/:id/reply", async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "text field required" });

    const result = await processReply(req.params.id, text);
    const session = getSession(req.params.id)!;

    // If an appointment was booked, write it to the real DB
    let appointmentId: number | null = null;
    if (result.appointment) {
      try {
        const appt = await storage.createAppointment({
          leadId: 1, // sandbox placeholder lead
          title: `${result.appointment.leadName} — ${result.appointment.industry} consultation`,
          scheduledAt: new Date(result.appointment.scheduledAt),
          status: "scheduled",
        });
        appointmentId = appt.id;
        await storage.logActivity({
          entityType: "appointment",
          entityId: appt.id,
          action: "sandbox_booked",
          details: JSON.stringify({
            leadName: result.appointment.leadName,
            scheduledAt: result.appointment.scheduledAt,
            source: "sandbox_demo",
          }),
          organizationId: null,
        });
      } catch (err: any) {
        console.warn("Sandbox: Could not write appointment to DB:", err.message);
      }
    }

    res.json({
      inboundText: text,
      analysis: result.analysis,
      aiResponse: result.responseMessage,
      events: result.events,
      lead: session.lead,
      sessionStatus: session.status,
      conversationLength: session.messages.length,
      agentActions: session.agentActions,
      appointment: result.appointment ? { ...result.appointment, id: appointmentId } : null,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ─── Run a full demo scenario automatically ─────────────────────────────────
router.post("/api/sandbox/demo/:scenarioId", async (req: Request, res: Response) => {
  try {
    const scenarioId = req.params.scenarioId as keyof typeof DEMO_SCENARIOS;
    const scenario = DEMO_SCENARIOS[scenarioId];
    if (!scenario) {
      return res.status(404).json({
        error: "Scenario not found",
        available: Object.keys(DEMO_SCENARIOS),
      });
    }

    // Create session with scenario lead
    const session = createSession(scenario.leadOverrides);
    const turns: Array<{
      turn: number;
      outbound: any;
      inbound?: { text: string; analysis: any; aiResponse: any };
    }> = [];

    // Run through each turn
    for (let i = 0; i < scenario.replies.length; i++) {
      const currentSession = getSession(session.id)!;
      const turn: any = { turn: i + 1 };

      // Only send outbound if session is active (not when waiting for appointment confirmation)
      if (currentSession.status === "active") {
        const outResult = await sendOutbound(session.id);
        turn.outbound = {
          message: outResult.message.content,
          step: outResult.message.metadata?.step,
        };
      }

      // Check if session can accept a reply
      const preReplySession = getSession(session.id)!;
      if (preReplySession.status !== "active" && preReplySession.status !== "appointment_proposed") {
        turns.push(turn);
        break;
      }

      // Process the reply
      const replyText = scenario.replies[i];
      const replyResult = await processReply(session.id, replyText);

      turn.inbound = {
        text: replyText,
        analysis: replyResult.analysis,
        aiResponse: replyResult.responseMessage?.content || null,
      };

      turns.push(turn);

      // Stop if session ended (opt-out, appointment confirmed)
      const updatedSession = getSession(session.id)!;
      if (updatedSession.status !== "active" && updatedSession.status !== "appointment_proposed") break;
    }

    const finalSession = getSession(session.id)!;

    res.json({
      scenario: { id: scenarioId, name: scenario.name, description: scenario.description },
      sessionId: session.id,
      turns,
      finalState: {
        status: finalSession.status,
        lead: finalSession.lead,
        messageCount: finalSession.messages.length,
        agentActions: finalSession.agentActions,
      },
      fullConversation: finalSession.messages.map((m) => ({
        direction: m.direction,
        content: m.content,
        timestamp: m.timestamp,
      })),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Get full conversation thread ───────────────────────────────────────────
router.get("/api/sandbox/sessions/:id/conversation", (req: Request, res: Response) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  res.json({
    sessionId: session.id,
    status: session.status,
    lead: session.lead,
    conversation: session.messages.map((m) => ({
      direction: m.direction,
      from: m.direction === "outbound" ? "Aria (AI)" : `${session.lead.firstName} ${session.lead.lastName}`,
      content: m.content,
      timestamp: m.timestamp,
      metadata: m.metadata,
    })),
    events: session.events,
    agentActions: session.agentActions,
  });
});

// ─── HELPERS ────────────────────────────────────────────────────────────────

function formatSession(session: any) {
  return {
    id: session.id,
    lead: session.lead,
    messageCount: session.messages.length,
    status: session.status,
    lastMessage: session.messages.length > 0
      ? {
          direction: session.messages[session.messages.length - 1].direction,
          content: session.messages[session.messages.length - 1].content,
          timestamp: session.messages[session.messages.length - 1].timestamp,
        }
      : null,
    agentActions: session.agentActions,
    createdAt: session.createdAt,
  };
}

export default router;
