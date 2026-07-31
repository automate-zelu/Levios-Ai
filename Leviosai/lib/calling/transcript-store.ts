// ─── TRANSCRIPT STORE ────────────────────────────────────────────────────────
// In-memory + serializable transcript accumulator for a single live call.
// Used by AudioPipeline during the WebSocket session, then persisted to
// sdr_call_sessions.transcript at call end.

export type TranscriptSpeaker = "ai" | "lead";

export interface TranscriptLine {
  speaker: TranscriptSpeaker;
  text: string;
  /** Unix epoch ms when the line was appended */
  at: number;
}

export class TranscriptStore {
  private lines: TranscriptLine[] = [];

  append(speaker: TranscriptSpeaker, text: string, at = Date.now()): void {
    const trimmed = text?.trim();
    if (!trimmed) return;
    this.lines.push({ speaker, text: trimmed, at });
  }

  /** Plain-text transcript for LLM outcome analysis + CRM display. */
  getFullTranscript(): string {
    return this.lines
      .map((l) => `${l.speaker.toUpperCase()}: ${l.text}`)
      .join("\n");
  }

  /** Timestamped lines for UI transcript viewers. */
  getLines(): readonly TranscriptLine[] {
    return this.lines;
  }

  /** JSON-serializable payload for DB / API responses. */
  toJSON(): TranscriptLine[] {
    return this.lines.map((l) => ({ ...l }));
  }

  get lineCount(): number {
    return this.lines.length;
  }

  get isEmpty(): boolean {
    return this.lines.length === 0;
  }

  /** Approximate conversation duration from first → last line (ms). */
  getDurationMs(): number {
    if (this.lines.length < 2) return 0;
    return this.lines[this.lines.length - 1].at - this.lines[0].at;
  }

  clear(): void {
    this.lines = [];
  }
}

/** Rebuild a store from previously persisted JSON lines (e.g. admin replay). */
export function transcriptStoreFromJSON(lines: TranscriptLine[]): TranscriptStore {
  const store = new TranscriptStore();
  for (const line of lines) {
    store.append(line.speaker, line.text, line.at);
  }
  return store;
}
