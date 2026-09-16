import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { callApi, sdrApi } from "../api.js";
import "./voice-ai.css";

export default function VoiceAIPage() {
  const navigate = useNavigate();
  const [voices, setVoices] = useState([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState("");
  const [importId, setImportId] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [savingVoice, setSavingVoice] = useState(false);
  const [voiceSaved, setVoiceSaved] = useState(false);
  const [playingId, setPlayingId] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => {
    setVoicesLoading(true);
    Promise.all([callApi.getVoices(), sdrApi.getConfig()])
      .then(([vList, cfg]) => {
        const list = vList || [];
        setVoices(list);
        if (cfg?.assistantVoiceId) {
          setSelectedVoiceId(cfg.assistantVoiceId);
          if (!list.some((v) => v.id === cfg.assistantVoiceId)) {
            setVoices([
              { id: cfg.assistantVoiceId, name: "Imported voice", previewUrl: "" },
              ...list,
            ]);
          }
        } else if (list.length) setSelectedVoiceId(list[0].id);
      })
      .catch(() => {})
      .finally(() => setVoicesLoading(false));
  }, []);

  const playPreview = (voiceId, url) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (playingId === voiceId) {
      setPlayingId(null);
      return;
    }
    if (!url) return;
    const audio = new Audio(url);
    audioRef.current = audio;
    setPlayingId(voiceId);
    audio.play().catch(() => setPlayingId(null));
    audio.onended = () => setPlayingId(null);
  };

  const importVoice = async () => {
    const id = importId.trim();
    if (!id) return;
    setImporting(true);
    setImportMsg("");
    try {
      const voice = await callApi.getVoice(id);
      setVoices((prev) => {
        if (prev.some((v) => v.id === voice.id)) return prev;
        return [voice, ...prev];
      });
      setSelectedVoiceId(voice.id);
      setImportMsg(`Loaded ${voice.name}. Save to use it on calls.`);
    } catch (e) {
      setImportMsg(e.message || "Could not load that voice ID");
    } finally {
      setImporting(false);
    }
  };

  const saveVoice = async () => {
    if (!selectedVoiceId) return;
    setSavingVoice(true);
    try {
      await sdrApi.saveVoice(selectedVoiceId);
      setVoiceSaved(true);
      setTimeout(() => setVoiceSaved(false), 3000);
    } catch {
      setImportMsg("Could not save voice");
    }
    setSavingVoice(false);
  };

  const selected = voices.find((v) => v.id === selectedVoiceId);

  return (
    <div className="voice-ai">
      <header className="voice-ai-hero">
        <div className="voice-ai-hero-top">
          <div>
            <div className="voice-ai-kicker">Outbound calls</div>
            <h1>Voice AI</h1>
            <p>
              Pick an ElevenLabs voice from your library, or paste a voice ID from the ElevenLabs dashboard.
            </p>
          </div>
          <div className="voice-ai-actions">
            <button type="button" className="voice-ai-btn voice-ai-btn--ghost" onClick={() => navigate("/sdr")}>
              Edit prompt
            </button>
            <button
              type="button"
              className="voice-ai-btn voice-ai-btn--primary"
              onClick={saveVoice}
              disabled={savingVoice || !selectedVoiceId}
            >
              {voiceSaved ? "Saved" : savingVoice ? "Saving…" : "Save voice"}
            </button>
          </div>
        </div>
        {selectedVoiceId && (
          <div className="voice-ai-ready">
            <strong>{selected?.name || "Custom"}</strong>
            <span>{selectedVoiceId}</span>
          </div>
        )}
      </header>

      <section className="voice-ai-workbench">
        <div className="voice-ai-workbench-head">
          <div className="voice-ai-tone">import</div>
          <h2>Voice ID</h2>
          <p>
            In ElevenLabs, open a voice → copy Voice ID. Private / cloned voices work if this workspace API key can access them.
          </p>
        </div>
        <div className="voice-ai-panel voice-ai-import">
          <input
            type="text"
            value={importId}
            onChange={(e) => setImportId(e.target.value)}
            placeholder="e.g. 21m00Tcm4TlvDq8ikWAM"
            aria-label="ElevenLabs voice ID"
            onKeyDown={(e) => {
              if (e.key === "Enter") importVoice();
            }}
          />
          <button
            type="button"
            className="voice-ai-btn voice-ai-btn--primary"
            disabled={importing || !importId.trim()}
            onClick={importVoice}
          >
            {importing ? "Looking up…" : "Import ID"}
          </button>
        </div>
        {importMsg && <p className="voice-ai-msg">{importMsg}</p>}
      </section>

      <section className="voice-ai-workbench">
        <div className="voice-ai-workbench-head">
          <div className="voice-ai-tone">library</div>
          <h2>Available voices</h2>
          <p>Select a card, preview if a sample exists, then save.</p>
        </div>
        <div className="voice-ai-panel">
          {voicesLoading ? (
            <div className="voice-ai-empty">Loading voices from ElevenLabs…</div>
          ) : voices.length === 0 ? (
            <div className="voice-ai-empty">
              No library voices yet. Import a Voice ID above, or check ELEVENLABS_API_KEY.
            </div>
          ) : (
            <div className="voice-ai-grid">
              {voices.map((v) => {
                const isSelected = selectedVoiceId === v.id;
                const isPreviewing = playingId === v.id;
                return (
                  <button
                    type="button"
                    key={v.id}
                    className={`voice-ai-card${isSelected ? " is-selected" : ""}`}
                    onClick={() => setSelectedVoiceId(v.id)}
                  >
                    <span
                      className={`voice-ai-play${isPreviewing ? " is-stop" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        playPreview(v.id, v.previewUrl);
                      }}
                      role="img"
                      aria-label={v.previewUrl ? (isPreviewing ? "Stop preview" : "Preview") : "No preview"}
                    >
                      {v.previewUrl ? (isPreviewing ? "■" : "▶") : "•"}
                    </span>
                    <span className="voice-ai-card-copy">
                      <strong>{v.name}</strong>
                      <em>{v.id}</em>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
