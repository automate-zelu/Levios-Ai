/** In-browser SDR rehearsal protocol (no Twilio). */

export type TestCallSpeaker = "you" | "agent";
export type TestCallStatus = "connecting" | "listening" | "thinking" | "speaking" | "ended";

export interface TestCallLine {
  id: string;
  speaker: TestCallSpeaker;
  text: string;
  at: number;
}

export function testCallShellState(open: boolean): {
  leftNav: "hidden" | "open";
  rightStudio: "open" | "closed";
} {
  return {
    leftNav: open ? "hidden" : "open",
    rightStudio: open ? "open" : "closed",
  };
}

export function testCallGreetingCue(assistantName?: string | null): string {
  const name = (assistantName || "").trim() || "the SDR agent";
  return (
    `[TEST_CALL_CONNECTED] This is an in-browser rehearsal, not a live phone call. ` +
    `You are ${name}. Greet the operator as if they were a live outbound lead. ` +
    `Keep the first greeting short. Do not mention this is a test unless they ask.`
  );
}

export function parseTestCallClientMessage(raw: unknown): {
  type: "start" | "pcm" | "text" | "end" | "unknown";
  text?: string;
  pcm?: Buffer;
} {
  let msg: any = raw;
  if (typeof raw === "string") {
    try {
      msg = JSON.parse(raw);
    } catch {
      return { type: "unknown" };
    }
  }
  if (!msg || typeof msg !== "object") return { type: "unknown" };
  const type = String(msg.type || "");
  if (type === "start" || type === "end") return { type };
  if (type === "text") {
    const text = String(msg.text || "").trim();
    return text ? { type: "text", text } : { type: "unknown" };
  }
  if (type === "pcm") {
    const data = String(msg.data || "");
    if (!data) return { type: "unknown" };
    try {
      return { type: "pcm", pcm: Buffer.from(data, "base64") };
    } catch {
      return { type: "unknown" };
    }
  }
  return { type: "unknown" };
}

export function appendTestCallLine(
  lines: TestCallLine[],
  speaker: TestCallSpeaker,
  text: string,
  now = Date.now()
): TestCallLine[] {
  const trimmed = (text || "").trim();
  if (!trimmed) return lines;
  return [
    ...lines,
    {
      id: `${now}-${lines.length}`,
      speaker,
      text: trimmed,
      at: now,
    },
  ];
}

export function browserTestWsPath(sessionId: string): string {
  return `/api/sdr/test-call/${encodeURIComponent(sessionId)}`;
}
