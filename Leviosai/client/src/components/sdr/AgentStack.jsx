import { useEffect, useState } from "react";
import { sdrApi } from "../../api.js";
import "./agent-stack.css";

function msLabel(ms) {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function groupedOptions(options = []) {
  const groups = [];
  for (const opt of options) {
    const provider = opt.provider || "Models";
    const last = groups[groups.length - 1];
    if (last && last.provider === provider) last.options.push(opt);
    else groups.push({ provider, options: [opt] });
  }
  return groups;
}

export default function AgentStack({ compact = false }) {
  const [stack, setStack] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    sdrApi
      .getVoiceStack()
      .then(setStack)
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 12000);
    return () => clearInterval(t);
  }, []);

  const stages = stack?.stages || [];
  const typical = stack?.typicalTotalMs ?? 980;
  const last = stack?.lastTotalMs ?? null;
  const isRealtime = stack?.mode === "realtime";

  const patchStack = async (partial) => {
    setSaving(true);
    try {
      const realtimeStage = stages.find((s) => s.id === "realtime");
      const next = await sdrApi.saveVoiceStack(
        isRealtime
          ? {
              realtimeModel: realtimeStage?.selected,
              assistantVoiceId: realtimeStage?.voiceId,
              ...partial,
            }
          : {
              sttModel: stages.find((s) => s.id === "transcriber")?.selected,
              llmModel: stages.find((s) => s.id === "llm")?.selected,
              ttsModel: stages.find((s) => s.id === "voice")?.selected,
              assistantVoiceId: stages.find((s) => s.id === "voice")?.voiceId,
              ...partial,
            }
      );
      setStack(next);
    } catch {
      /* keep current */
    } finally {
      setSaving(false);
    }
  };

  const fallback = [
    { id: "transcriber", label: "Transcriber", selected: "nova-2", options: [], typicalMs: 180, lastMs: null },
    { id: "llm", label: "LLM", selected: "gpt-4o", options: [], typicalMs: 520, lastMs: null },
    { id: "voice", label: "Voice", selected: "eleven_turbo_v2", options: [], typicalMs: 280, lastMs: null, voices: [] },
  ];

  return (
    <section
      className={`agent-stack${compact ? " is-compact" : ""}${isRealtime ? " is-realtime" : ""}`}
      aria-label="Conversation stack"
    >
      <div className="agent-stack-head">
        <h2>
          Stack
          {stack?.modeLabel ? <small className="agent-stack-mode">{stack.modeLabel}</small> : null}
        </h2>
        <span>
          {msLabel(last ?? typical)} {last != null ? "last" : "typical"}
        </span>
      </div>
      {stack?.note ? <p className="agent-stack-note">{stack.note}</p> : null}
      <ol className={`agent-stack-row${isRealtime ? " is-realtime" : ""}`}>
        {(stages.length ? stages : fallback).map((stage) => (
          <li key={stage.id} className={`agent-stack-card is-${stage.id}`}>
            <div className="agent-stack-meta">
              <span>{stage.label}</span>
              <em title={stage.lastMs != null ? "Last measured" : "Typical for this model"}>
                {msLabel(stage.lastMs ?? stage.typicalMs)}
              </em>
            </div>
            <div className="agent-stack-controls">
              <label className="agent-stack-select-wrap">
                <span className="agent-stack-field">Model</span>
                <select
                  className="agent-stack-select"
                  value={stage.selected}
                  disabled={saving || !(stage.options || []).length || stage.locked}
                  onChange={(e) => {
                    if (stage.id === "realtime") patchStack({ realtimeModel: e.target.value });
                    if (stage.id === "transcriber") patchStack({ sttModel: e.target.value });
                    if (stage.id === "llm") patchStack({ llmModel: e.target.value });
                    if (stage.id === "voice") patchStack({ ttsModel: e.target.value });
                  }}
                >
                  {groupedOptions(stage.options).map((group) => (
                    <optgroup key={group.provider} label={group.provider}>
                      {group.options.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label} · {msLabel(opt.typicalMs)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              {(stage.id === "voice" || stage.id === "realtime") && (stage.voices || []).length > 0 && (
                <label className="agent-stack-select-wrap">
                  <span className="agent-stack-field">Speaker</span>
                  <select
                    className="agent-stack-select"
                    value={
                      (stage.voices || []).some((v) => v.id === stage.voiceId)
                        ? stage.voiceId || ""
                        : stage.voiceId?.startsWith("voice_")
                          ? stage.voiceId
                          : stage.voices?.[0]?.id || ""
                    }
                    disabled={saving}
                    onChange={(e) => patchStack({ assistantVoiceId: e.target.value })}
                  >
                    {stage.id === "realtime" ? null : <option value="">Default</option>}
                    {(stage.voices || []).map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {stage.id === "realtime" && (
                <label className="agent-stack-select-wrap">
                  <span className="agent-stack-field">Custom voice id</span>
                  <input
                    className="agent-stack-select"
                    type="text"
                    placeholder="voice_…"
                    disabled={saving}
                    defaultValue={stage.voiceId?.startsWith("voice_") ? stage.voiceId : ""}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v) patchStack({ assistantVoiceId: v });
                    }}
                  />
                </label>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
