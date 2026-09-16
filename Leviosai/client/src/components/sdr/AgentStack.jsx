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

  const patchStack = async (partial) => {
    setSaving(true);
    try {
      const next = await sdrApi.saveVoiceStack({
        sttModel: stages.find((s) => s.id === "transcriber")?.selected,
        llmModel: stages.find((s) => s.id === "llm")?.selected,
        ttsModel: stages.find((s) => s.id === "voice")?.selected,
        assistantVoiceId: stages.find((s) => s.id === "voice")?.voiceId,
        ...partial,
      });
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
    <section className={`agent-stack${compact ? " is-compact" : ""}`} aria-label="Conversation stack">
      <div className="agent-stack-head">
        <h2>Stack</h2>
        <span>
          {msLabel(last ?? typical)} {last != null ? "last" : "typical"}
        </span>
      </div>
      <ol className="agent-stack-row">
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
                  disabled={saving || !(stage.options || []).length}
                  onChange={(e) => {
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
              {stage.id === "voice" && (stage.voices || []).length > 0 && (
                <label className="agent-stack-select-wrap">
                  <span className="agent-stack-field">Speaker</span>
                  <select
                    className="agent-stack-select"
                    value={stage.voiceId || ""}
                    disabled={saving}
                    onChange={(e) => patchStack({ assistantVoiceId: e.target.value })}
                  >
                    <option value="">Default</option>
                    {(stage.voices || []).map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
