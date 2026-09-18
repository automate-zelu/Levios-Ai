import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import type WebSocket from "ws";
import { LangChainCallAgent } from "./langchain-agent.js";
import { DeepgramSTTClient } from "./deepgram-client.js";
import { ElevenLabsClient } from "./elevenlabs-client.js";
import { shortenGreeting } from "./pipeline-helpers.js";
import { recordWorkspaceLatency, type LatencySample } from "../agent-stack.js";
import { consumeTestCallMinutes } from "../test-credits-apply.js";
import { TEST_CALL_HARD_CAP_SECONDS, testCallClock } from "../test-credits.js";
import {
  appendTestCallLine,
  parseTestCallClientMessage,
  testCallGreetingCue,
  type TestCallLine,
} from "./browser-test-protocol.js";

const JWT_SECRET = process.env.JWT_SECRET || "catalyst-dev-secret-change-in-production";
const SESSION_TTL_MS = 20 * 60_000;

export interface BrowserTestCallConfig {
  workspaceId: string;
  organizationId: number;
  systemPrompt: string;
  assistantName?: string | null;
  assistantVoiceId?: string | null;
  sttModel?: string | null;
  llmModel?: string | null;
  ttsModel?: string | null;
  allowPaid?: boolean;
  budgetSeconds?: number;
}

interface LiveSession {
  id: string;
  cfg: BrowserTestCallConfig;
  createdAt: number;
}

const pending = new Map<string, LiveSession>();

function sendJson(ws: WebSocket, payload: Record<string, unknown>) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

export function createBrowserTestCall(cfg: BrowserTestCallConfig): { sessionId: string } {
  const sessionId = randomUUID();
  pending.set(sessionId, { id: sessionId, cfg, createdAt: Date.now() });
  return { sessionId };
}

export function getBrowserTestCall(sessionId: string): LiveSession | null {
  const row = pending.get(sessionId);
  if (!row) return null;
  if (Date.now() - row.createdAt > SESSION_TTL_MS) {
    pending.delete(sessionId);
    return null;
  }
  return row;
}

export function verifyBrowserTestToken(token: string | null): {
  workspaceId: string;
  organizationId: number;
} | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const workspaceId = decoded.workspaceId as string | undefined;
    const organizationId = Number(decoded.organizationId);
    if (!organizationId) return null;
    return { workspaceId: workspaceId || "", organizationId };
  } catch {
    return null;
  }
}

export async function handleBrowserTestCallStream(
  ws: WebSocket,
  sessionId: string,
  token: string | null
): Promise<void> {
  const auth = verifyBrowserTestToken(token);
  const live = getBrowserTestCall(sessionId);
  if (!auth || !live || live.cfg.organizationId !== auth.organizationId) {
    sendJson(ws, { type: "error", message: "Unauthorized test call" });
    ws.close(1008, "unauthorized");
    return;
  }

  const agent = new LangChainCallAgent();
  const deepgram = new DeepgramSTTClient();
  const tts = new ElevenLabsClient();
  let lines: TestCallLine[] = [];
  let busy = false;
  let ended = false;
  const startedAt = Date.now();
  const latencyTurns: LatencySample[] = [];
  let lastSttAt = 0;
  const budgetSeconds = live.cfg.budgetSeconds ?? TEST_CALL_HARD_CAP_SECONDS;
  let tick: ReturnType<typeof setInterval> | null = null;

  const speak = async (text: string) => {
    const spoken = (text || "").trim();
    if (!spoken) return;
    lines = appendTestCallLine(lines, "agent", spoken);
    sendJson(ws, { type: "line", speaker: "agent", text: spoken, lines });
    sendJson(ws, { type: "status", status: "speaking" });
    const ttsStarted = Date.now();
    try {
      const mp3 = await tts.synthesizeMp3(spoken, live.cfg.assistantVoiceId, live.cfg.ttsModel);
      const ttsMs = Date.now() - ttsStarted;
      sendJson(ws, {
        type: "audio",
        mime: "audio/mpeg",
        text: spoken,
        data: mp3.toString("base64"),
      });
      return ttsMs;
    } catch (err: any) {
      sendJson(ws, {
        type: "tts_error",
        speak: spoken,
        message: err?.message || "Voice playback unavailable — transcript still works",
      });
      return Date.now() - ttsStarted;
    } finally {
      sendJson(ws, { type: "status", status: "listening" });
    }
  };

  const emitLatency = (sample: LatencySample) => {
    latencyTurns.push(sample);
    recordWorkspaceLatency(live.cfg.workspaceId, {
      sttMs: Math.round(latencyTurns.reduce((s, x) => s + x.sttMs, 0) / latencyTurns.length),
      llmMs: Math.round(latencyTurns.reduce((s, x) => s + x.llmMs, 0) / latencyTurns.length),
      ttsMs: Math.round(latencyTurns.reduce((s, x) => s + x.ttsMs, 0) / latencyTurns.length),
    });
    sendJson(ws, {
      type: "latency",
      ...sample,
      totalMs: sample.sttMs + sample.llmMs + sample.ttsMs,
    });
  };

  const handleUtterance = async (text: string) => {
    const trimmed = (text || "").trim();
    if (!trimmed || busy || ended) return;
    if (testCallClock(Math.ceil((Date.now() - startedAt) / 1000), budgetSeconds).exhausted) return;
    busy = true;
    deepgram.muteInput();
    const sttMs = lastSttAt ? Math.min(4000, Date.now() - lastSttAt) : 180;
    lastSttAt = 0;
    lines = appendTestCallLine(lines, "you", trimmed);
    sendJson(ws, { type: "line", speaker: "you", text: trimmed, lines });
    sendJson(ws, { type: "partial", text: "" });
    sendJson(ws, { type: "status", status: "thinking" });
    try {
      const llmStarted = Date.now();
      const reply = await agent.respond(sessionId, trimmed);
      const llmMs = Date.now() - llmStarted;
      const ttsMs = (await speak(reply)) || 0;
      emitLatency({ sttMs, llmMs, ttsMs });
    } catch (err: any) {
      sendJson(ws, { type: "error", message: err?.message || "Agent failed" });
      sendJson(ws, { type: "status", status: "listening" });
    } finally {
      deepgram.unmuteInput();
      busy = false;
    }
  };

  const shutdown = (reason: "user" | "minutes_exhausted" | "disconnect" = "disconnect") => {
    if (ended) return;
    ended = true;
    if (tick) clearInterval(tick);
    pending.delete(sessionId);
    deepgram.disconnect();
    const rawSeconds = Math.max(1, Math.ceil((Date.now() - startedAt) / 1000));
    const durationSeconds = Math.min(rawSeconds, budgetSeconds);
    const clock = testCallClock(durationSeconds, budgetSeconds);
    consumeTestCallMinutes(live.cfg.workspaceId, durationSeconds, live.cfg.allowPaid === true)
      .then((credits) => {
        sendJson(ws, {
          type: "clock",
          ...clock,
          budgetSeconds,
        });
        sendJson(ws, { type: "credits", credits });
        sendJson(ws, { type: "status", status: "ended" });
        sendJson(ws, {
          type: "ended",
          reason,
          lines,
          credits,
          message:
            reason === "minutes_exhausted"
              ? live.cfg.allowPaid
                ? "Calling minutes for this rehearsal ran out. The test ended and remaining paid minutes were not over-billed."
                : "Free test minutes for this rehearsal ran out. The test ended. Paid monthly calling minutes were not used."
              : credits.consumeMessage,
        });
      })
      .catch(() => {
        sendJson(ws, { type: "status", status: "ended" });
        sendJson(ws, { type: "ended", reason, lines });
      })
      .finally(() => {
        try {
          ws.close(1000, reason);
        } catch {
          /* ignore */
        }
      });
  };

  ws.on("message", async (raw: Buffer) => {
    const parsed = parseTestCallClientMessage(raw.toString());
    if (parsed.type === "end") {
      shutdown("user");
      return;
    }
    if (parsed.type === "text" && parsed.text) {
      await handleUtterance(parsed.text);
      return;
    }
    if (parsed.type === "pcm" && parsed.pcm) {
      if (ended) return;
      deepgram.sendAudio(parsed.pcm);
    }
  });

  ws.on("close", () => shutdown("disconnect"));
  ws.on("error", () => shutdown("disconnect"));

  sendJson(ws, { type: "status", status: "connecting" });
  sendJson(ws, {
    type: "clock",
    ...testCallClock(0, budgetSeconds),
    budgetSeconds,
  });

  tick = setInterval(() => {
    if (ended) return;
    const elapsed = Math.ceil((Date.now() - startedAt) / 1000);
    const clock = testCallClock(elapsed, budgetSeconds);
    sendJson(ws, { type: "clock", ...clock, budgetSeconds });
    if (clock.exhausted) {
      sendJson(ws, {
        type: "minutes_exhausted",
        message: live.cfg.allowPaid
          ? "Minutes ran out during this rehearsal. Ending now."
          : "Free test minutes ran out during this rehearsal. Ending now without using paid monthly credits.",
      });
      shutdown("minutes_exhausted");
    }
  }, 1000);

  await agent.init({
    sessionId,
    systemPrompt: live.cfg.systemPrompt || "",
    workspaceId: live.cfg.workspaceId,
    organizationId: live.cfg.organizationId,
    leadId: null,
    llmModel: live.cfg.llmModel,
  });

  deepgram.onTranscript((text) => {
    handleUtterance(text).catch((err) =>
      sendJson(ws, { type: "error", message: err?.message || "STT turn failed" })
    );
  });
  deepgram.onPartial((text) => {
    if (text && !lastSttAt) lastSttAt = Date.now();
    sendJson(ws, { type: "partial", text });
  });

  try {
    await deepgram.connect({
      encoding: "linear16",
      sampleRate: 16000,
      model: live.cfg.sttModel || undefined,
    });
  } catch (err: any) {
    sendJson(ws, {
      type: "stt_error",
      message: err?.message || "Microphone transcription unavailable — type instead",
    });
  }

  sendJson(ws, { type: "status", status: "thinking" });
  try {
    const llmStarted = Date.now();
    const raw = await agent.respond(sessionId, testCallGreetingCue(live.cfg.assistantName));
    const llmMs = Date.now() - llmStarted;
    const greeting = shortenGreeting(raw);
    if (greeting !== raw.trim()) await agent.replaceLastAiMessage(sessionId, greeting);
    const ttsMs = (await speak(greeting)) || 0;
    emitLatency({ sttMs: 0, llmMs, ttsMs });
  } catch (err: any) {
    sendJson(ws, { type: "error", message: err?.message || "Greeting failed" });
    sendJson(ws, { type: "status", status: "listening" });
  }
}
