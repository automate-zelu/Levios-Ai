/** Conversation stack: classic STT→LLM→TTS, or OpenAI Realtime speech-to-speech. */

export interface StackOption {
  id: string;
  label: string;
  typicalMs: number;
  provider?: string;
}

export interface StackStage {
  id: "transcriber" | "llm" | "voice" | "realtime";
  label: string;
  provider: string;
  model: string;
  selected: string;
  options: StackOption[];
  typicalMs: number;
  lastMs: number | null;
  voiceId?: string | null;
  voiceName?: string | null;
  voices?: Array<{ id: string; name: string }>;
  locked?: boolean;
}

export interface LatencySample {
  sttMs: number;
  llmMs: number;
  ttsMs: number;
}

const lastByWorkspace = new Map<string, LatencySample>();

export const TRANSCRIBER_OPTIONS: StackOption[] = [
  { id: "nova-3", label: "Nova-3", typicalMs: 165, provider: "Deepgram" },
  { id: "nova-2", label: "Nova-2", typicalMs: 180, provider: "Deepgram" },
  { id: "nova-2-phonecall", label: "Nova-2 Phonecall", typicalMs: 155, provider: "Deepgram" },
  { id: "nova-2-conversationalai", label: "Nova-2 Conversational", typicalMs: 170, provider: "Deepgram" },
];

export const LLM_OPTIONS: StackOption[] = [
  { id: "gpt-4o", label: "GPT-4o", typicalMs: 520, provider: "OpenAI" },
  { id: "gpt-4o-mini", label: "GPT-4o mini", typicalMs: 280, provider: "OpenAI" },
  { id: "gpt-4.1", label: "GPT-4.1", typicalMs: 480, provider: "OpenAI" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", typicalMs: 260, provider: "OpenAI" },
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", typicalMs: 540, provider: "Anthropic" },
  { id: "claude-3-5-haiku-20241022", label: "Claude Haiku 3.5", typicalMs: 220, provider: "Anthropic" },
];

export const TTS_OPTIONS: StackOption[] = [
  { id: "eleven_flash_v2_5", label: "Flash v2.5", typicalMs: 150, provider: "ElevenLabs" },
  { id: "eleven_flash_v2", label: "Flash v2", typicalMs: 170, provider: "ElevenLabs" },
  { id: "eleven_turbo_v2_5", label: "Turbo v2.5", typicalMs: 240, provider: "ElevenLabs" },
  { id: "eleven_turbo_v2", label: "Turbo v2", typicalMs: 280, provider: "ElevenLabs" },
  { id: "eleven_multilingual_v2", label: "Multilingual v2", typicalMs: 420, provider: "ElevenLabs" },
];

export const REALTIME_MODEL_OPTIONS: StackOption[] = [
  { id: "gpt-realtime", label: "GPT Realtime", typicalMs: 420, provider: "OpenAI" },
  { id: "gpt-realtime-2.1", label: "GPT Realtime 2.1", typicalMs: 400, provider: "OpenAI" },
  { id: "gpt-4o-realtime-preview", label: "GPT-4o Realtime Preview", typicalMs: 450, provider: "OpenAI" },
];

export const REALTIME_VOICE_OPTIONS: Array<{ id: string; name: string }> = [
  { id: "marin", name: "Marin (recommended)" },
  { id: "cedar", name: "Cedar (recommended)" },
  { id: "alloy", name: "Alloy" },
  { id: "ash", name: "Ash" },
  { id: "ballad", name: "Ballad" },
  { id: "coral", name: "Coral" },
  { id: "echo", name: "Echo" },
  { id: "sage", name: "Sage" },
  { id: "shimmer", name: "Shimmer" },
  { id: "verse", name: "Verse" },
];

export const DEFAULT_STT_MODEL = "nova-2";
export const DEFAULT_LLM_MODEL = "gpt-4o";
export const DEFAULT_TTS_MODEL = "eleven_turbo_v2";
export const DEFAULT_REALTIME_MODEL = "gpt-realtime";
export const DEFAULT_REALTIME_VOICE = "marin";

export const DEFAULT_AGENT_STACK: Omit<StackStage, "lastMs" | "selected" | "options">[] = [
  {
    id: "transcriber",
    label: "Transcriber",
    provider: "Deepgram",
    model: "Nova-2",
    typicalMs: 180,
  },
  {
    id: "llm",
    label: "LLM",
    provider: "OpenAI",
    model: "GPT-4o",
    typicalMs: 520,
  },
  {
    id: "voice",
    label: "Voice",
    provider: "ElevenLabs",
    model: "Turbo v2",
    typicalMs: 280,
  },
];

function pick(options: StackOption[], id: string | null | undefined, fallback: string): StackOption {
  const wanted = (id || "").trim();
  return options.find((o) => o.id === wanted) || options.find((o) => o.id === fallback) || options[0];
}

export function resolveSttModel(id?: string | null): string {
  return pick(TRANSCRIBER_OPTIONS, id, DEFAULT_STT_MODEL).id;
}

export function resolveLlmModel(id?: string | null): string {
  return pick(LLM_OPTIONS, id, DEFAULT_LLM_MODEL).id;
}

export function isClaudeModel(id?: string | null): boolean {
  return (id || "").startsWith("claude-");
}

export function resolveTtsModel(id?: string | null): string {
  return pick(TTS_OPTIONS, id, DEFAULT_TTS_MODEL).id;
}

export function resolveRealtimeModel(id?: string | null): string {
  return pick(REALTIME_MODEL_OPTIONS, id, DEFAULT_REALTIME_MODEL).id;
}

export function resolveRealtimeVoice(id?: string | null): string {
  const wanted = (id || "").trim();
  if (!wanted) return DEFAULT_REALTIME_VOICE;
  const lower = wanted.toLowerCase();
  if (REALTIME_VOICE_OPTIONS.some((v) => v.id === lower)) return lower;
  // Allow custom OpenAI voice ids
  if (/^voice_[a-zA-Z0-9_-]+$/.test(wanted)) return wanted;
  return DEFAULT_REALTIME_VOICE;
}

export function recordWorkspaceLatency(workspaceId: string, sample: LatencySample): void {
  lastByWorkspace.set(workspaceId, {
    sttMs: Math.max(0, Math.round(sample.sttMs)),
    llmMs: Math.max(0, Math.round(sample.llmMs)),
    ttsMs: Math.max(0, Math.round(sample.ttsMs)),
  });
}

export function getWorkspaceLatency(workspaceId: string): LatencySample | null {
  return lastByWorkspace.get(workspaceId) || null;
}

export function buildAgentStack(opts: {
  workspaceId?: string | null;
  voiceName?: string | null;
  voiceId?: string | null;
  voices?: Array<{ id: string; name: string }>;
  sttModel?: string | null;
  llmModel?: string | null;
  ttsModel?: string | null;
  /** When true, live calls use OpenAI Realtime (not Deepgram/ElevenLabs). */
  realtime?: boolean;
  realtimeModel?: string | null;
  realtimeVoice?: string | null;
}): {
  mode: "realtime" | "classic";
  modeLabel: string;
  stages: StackStage[];
  typicalTotalMs: number;
  lastTotalMs: number | null;
  note?: string;
} {
  if (opts.realtime) {
    const model = pick(
      REALTIME_MODEL_OPTIONS,
      opts.realtimeModel || process.env.OPENAI_REALTIME_MODEL,
      DEFAULT_REALTIME_MODEL
    );
    const voiceId = resolveRealtimeVoice(
      opts.realtimeVoice || opts.voiceId || process.env.OPENAI_REALTIME_VOICE
    );
    const voiceName = REALTIME_VOICE_OPTIONS.find((v) => v.id === voiceId)?.name || voiceId;
    const voices = [...REALTIME_VOICE_OPTIONS];
    if (voiceId.startsWith("voice_") && !voices.some((v) => v.id === voiceId)) {
      voices.push({ id: voiceId, name: `Custom (${voiceId})` });
    }

    const stages: StackStage[] = [
      {
        id: "realtime",
        label: "Speech-to-speech",
        provider: "OpenAI",
        model: model.label,
        selected: model.id,
        options: REALTIME_MODEL_OPTIONS,
        typicalMs: model.typicalMs,
        lastMs: null,
        voiceId,
        voiceName,
        voices,
        locked: false,
      },
    ];

    return {
      mode: "realtime",
      modeLabel: "OpenAI Realtime",
      stages,
      typicalTotalMs: model.typicalMs,
      lastTotalMs: null,
      note: "Live calls use one OpenAI Realtime session (listen + think + speak). Deepgram / ElevenLabs settings apply only if CALL_VOICE_STACK=classic.",
    };
  }

  const last = opts.workspaceId ? getWorkspaceLatency(opts.workspaceId) : null;
  const stt = pick(TRANSCRIBER_OPTIONS, opts.sttModel, DEFAULT_STT_MODEL);
  const llm = pick(LLM_OPTIONS, opts.llmModel, DEFAULT_LLM_MODEL);
  const tts = pick(TTS_OPTIONS, opts.ttsModel, DEFAULT_TTS_MODEL);

  const stages: StackStage[] = [
    {
      id: "transcriber",
      label: "Transcriber",
      provider: "Deepgram",
      model: stt.label,
      selected: stt.id,
      options: TRANSCRIBER_OPTIONS,
      typicalMs: stt.typicalMs,
      lastMs: last?.sttMs ?? null,
    },
    {
      id: "llm",
      label: "LLM",
      provider: llm.provider || (llm.id.startsWith("claude-") ? "Anthropic" : "OpenAI"),
      model: llm.label,
      selected: llm.id,
      options: LLM_OPTIONS,
      typicalMs: llm.typicalMs,
      lastMs: last?.llmMs ?? null,
    },
    {
      id: "voice",
      label: "Voice",
      provider: "ElevenLabs",
      model: tts.label,
      selected: tts.id,
      options: TTS_OPTIONS,
      typicalMs: tts.typicalMs,
      lastMs: last?.ttsMs ?? null,
      voiceId: opts.voiceId || null,
      voiceName: opts.voiceName?.trim() || null,
      voices: opts.voices || [],
    },
  ];

  const typicalTotalMs = stages.reduce((sum, s) => sum + s.typicalMs, 0);
  const lastTotalMs = last ? last.sttMs + last.llmMs + last.ttsMs : null;
  return {
    mode: "classic",
    modeLabel: "Classic pipeline",
    stages,
    typicalTotalMs,
    lastTotalMs,
  };
}

export function averageSample(samples: LatencySample[]): LatencySample {
  if (!samples.length) return { sttMs: 0, llmMs: 0, ttsMs: 0 };
  const n = samples.length;
  return {
    sttMs: Math.round(samples.reduce((s, x) => s + x.sttMs, 0) / n),
    llmMs: Math.round(samples.reduce((s, x) => s + x.llmMs, 0) / n),
    ttsMs: Math.round(samples.reduce((s, x) => s + x.ttsMs, 0) / n),
  };
}
