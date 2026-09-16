// ─── LIVE CALL REGISTRY ───────────────────────────────────────────────────────
// In-memory hub for active call transcripts so the Live Calls monitor can stream
// user + agent lines without waiting for call-end persistence.

import type { TranscriptLine } from "./transcript-store.js";

export type LiveCallEvent =
  | { type: "snapshot"; sessionId: string; status: string; lines: TranscriptLine[] }
  | { type: "line"; sessionId: string; line: TranscriptLine; lines: TranscriptLine[] }
  | { type: "status"; sessionId: string; status: string }
  | { type: "ended"; sessionId: string; status: string; lines: TranscriptLine[] };

type LiveListener = (event: LiveCallEvent) => void;

export interface LiveCallState {
  sessionId: string;
  workspaceId: string;
  status: string;
  lines: TranscriptLine[];
  startedAt: number;
  updatedAt: number;
}

interface InternalState extends LiveCallState {
  listeners: Set<LiveListener>;
}

const sessions = new Map<string, InternalState>();

function emit(state: InternalState, event: LiveCallEvent): void {
  for (const listener of state.listeners) {
    try {
      listener(event);
    } catch {
      // Listener errors must not break the call pipeline
    }
  }
}

export const liveCallRegistry = {
  start(sessionId: string, workspaceId: string, seed: TranscriptLine[] = []): LiveCallState {
    const existing = sessions.get(sessionId);
    if (existing) {
      existing.workspaceId = workspaceId;
      if (seed.length && existing.lines.length === 0) {
        existing.lines = seed.map((l) => ({ ...l }));
      }
      existing.updatedAt = Date.now();
      return publicState(existing);
    }

    const state: InternalState = {
      sessionId,
      workspaceId,
      status: "active",
      lines: seed.map((l) => ({ ...l })),
      startedAt: Date.now(),
      updatedAt: Date.now(),
      listeners: new Set(),
    };
    sessions.set(sessionId, state);
    return publicState(state);
  },

  append(sessionId: string, line: TranscriptLine): void {
    const state = sessions.get(sessionId);
    if (!state) return;
    state.lines.push({ ...line });
    state.updatedAt = Date.now();
    emit(state, {
      type: "line",
      sessionId,
      line: { ...line },
      lines: state.lines.map((l) => ({ ...l })),
    });
  },

  setStatus(sessionId: string, status: string): void {
    const state = sessions.get(sessionId);
    if (!state) return;
    state.status = status;
    state.updatedAt = Date.now();
    emit(state, { type: "status", sessionId, status });
  },

  get(sessionId: string): LiveCallState | null {
    const state = sessions.get(sessionId);
    return state ? publicState(state) : null;
  },

  listByWorkspace(workspaceId: string): LiveCallState[] {
    return [...sessions.values()]
      .filter((s) => s.workspaceId === workspaceId)
      .map(publicState)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },

  subscribe(sessionId: string, listener: LiveListener): () => void {
    const state = sessions.get(sessionId);
    if (!state) {
      listener({ type: "ended", sessionId, status: "unknown", lines: [] });
      return () => {};
    }
    state.listeners.add(listener);
    listener({
      type: "snapshot",
      sessionId,
      status: state.status,
      lines: state.lines.map((l) => ({ ...l })),
    });
    return () => {
      state.listeners.delete(listener);
    };
  },

  end(sessionId: string, status = "completed"): void {
    const state = sessions.get(sessionId);
    if (!state) return;
    state.status = status;
    state.updatedAt = Date.now();
    emit(state, {
      type: "ended",
      sessionId,
      status,
      lines: state.lines.map((l) => ({ ...l })),
    });
    sessions.delete(sessionId);
  },
};

function publicState(state: InternalState): LiveCallState {
  return {
    sessionId: state.sessionId,
    workspaceId: state.workspaceId,
    status: state.status,
    lines: state.lines.map((l) => ({ ...l })),
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
  };
}

/** Parse DB transcript column (JSON lines or plain AI:/LEAD: text). */
export function parseStoredTranscript(raw: string | null | undefined): TranscriptLine[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((l) => l && (l.speaker === "ai" || l.speaker === "lead") && typeof l.text === "string")
        .map((l) => ({
          speaker: l.speaker as "ai" | "lead",
          text: String(l.text),
          at: typeof l.at === "number" ? l.at : 0,
        }));
    }
  } catch {
    // plain text fallthrough
  }
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const isAi = /^AI:/i.test(line);
      return {
        speaker: (isAi ? "ai" : "lead") as "ai" | "lead",
        text: line.replace(/^(AI|LEAD):\s*/i, ""),
        at: 0,
      };
    });
}
