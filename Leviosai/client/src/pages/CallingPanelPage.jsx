import { useEffect, useRef, useState } from "react";
import { COLORS, S } from "../theme.js";
import { callApi, sdrApi } from "../api.js";
import { CallLogTable } from "../components/calling/CallLogTable.jsx";
import { CallingAnalyticsCards } from "../components/calling/CallingAnalyticsCards.jsx";
import { RecordingPlayer } from "../components/calling/RecordingPlayer.jsx";
import { TranscriptViewer } from "../components/calling/TranscriptViewer.jsx";

const OUTCOME_COLORS = {
  booked: COLORS.green, qualified: COLORS.teal, answered: COLORS.blue,
  no_answer: COLORS.textMuted, voicemail: COLORS.yellow, busy: COLORS.orange, failed: COLORS.red,
};
const STATUS_COLORS = { initiated: COLORS.yellow, active: COLORS.green, completed: COLORS.textMuted };
const STATUS_LABELS = { initiated: "Dialing…", active: "Live", completed: "Completed" };

export default function CallingPanelPage() {
  const [sessions, setSessions] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("log");

  const [voices, setVoices] = useState([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState("");
  const [savingVoice, setSavingVoice] = useState(false);
  const [voiceSaved, setVoiceSaved] = useState(false);
  const [playingId, setPlayingId] = useState(null);
  const audioRef = useRef(null);
  const selectedRef = useRef(null);
  selectedRef.current = selected;

  const fetchData = async (silent = false) => {
    try {
      const [s, a] = await Promise.all([
        callApi.getSessions({ limit: 50 }),
        callApi.getAnalytics(),
      ]);
      setSessions(s?.data || []);
      setAnalytics(a);
      const cur = selectedRef.current;
      if (cur) {
        const refreshed = (s?.data || []).find((x) => x.id === cur.id);
        if (refreshed) setSelected(refreshed);
      }
    } catch { /* ignore */ }
    if (!silent) setLoading(false);
  };

  useEffect(() => {
    fetchData();
    setVoicesLoading(true);
    Promise.all([callApi.getVoices(), sdrApi.getConfig()])
      .then(([vList, cfg]) => {
        setVoices(vList || []);
        if (cfg?.assistantVoiceId) setSelectedVoiceId(cfg.assistantVoiceId);
        else if (vList?.length) setSelectedVoiceId(vList[0].id);
      })
      .catch(() => {})
      .finally(() => setVoicesLoading(false));
  }, []);

  useEffect(() => {
    const hasActive = sessions.some((s) => s.status !== "completed");
    if (!hasActive) return;
    const t = setInterval(() => fetchData(true), 5000);
    return () => clearInterval(t);
  }, [sessions]);

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

  const saveVoice = async () => {
    if (!selectedVoiceId) return;
    setSavingVoice(true);
    try {
      await sdrApi.saveVoice(selectedVoiceId);
      setVoiceSaved(true);
      setTimeout(() => setVoiceSaved(false), 3000);
    } catch { /* ignore */ }
    setSavingVoice(false);
  };

  if (loading) {
    return (
      <div className="loading-state">
        <div className="loading-spinner" />
        <div style={{ fontSize: 14, color: COLORS.textMuted }}>Loading call data…</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>AI Calling</h2>
        <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "4px 0 0" }}>
          Live call sessions powered by Twilio + Deepgram + GPT-4o + ElevenLabs
        </p>
      </div>

      <CallingAnalyticsCards analytics={analytics} />

      <div style={S.card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={S.cardHeader}>AI Voice</div>
            <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 2 }}>
              Select the ElevenLabs voice your AI agent will use on calls
            </div>
          </div>
          <button
            type="button"
            style={{ ...S.btn("primary"), padding: "8px 20px", opacity: savingVoice ? 0.6 : 1 }}
            onClick={saveVoice}
            disabled={savingVoice || !selectedVoiceId}
          >
            {voiceSaved ? "✓ Saved" : savingVoice ? "Saving…" : "Save Voice"}
          </button>
        </div>

        {voicesLoading ? (
          <div style={{ color: COLORS.textMuted, fontSize: 13, padding: "12px 0" }}>Loading voices from ElevenLabs…</div>
        ) : voices.length === 0 ? (
          <div style={{ color: COLORS.textMuted, fontSize: 13, padding: "12px 0" }}>
            No voices found. Check that ELEVENLABS_API_KEY is set.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
            {voices.map((v) => {
              const isSelected = selectedVoiceId === v.id;
              const isPreviewing = playingId === v.id;
              return (
                <div
                  key={v.id}
                  onClick={() => setSelectedVoiceId(v.id)}
                  style={{
                    border: `2px solid ${isSelected ? COLORS.purple : COLORS.border}`,
                    borderRadius: 10,
                    padding: "12px 14px",
                    cursor: "pointer",
                    background: isSelected ? "rgba(155,89,182,0.08)" : COLORS.surfaceAlt,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); playPreview(v.id, v.previewUrl); }}
                    style={{
                      width: 34, height: 34, borderRadius: "50%", border: "none", cursor: "pointer",
                      background: isPreviewing ? COLORS.orange : isSelected ? COLORS.purple : COLORS.border,
                      color: "#fff", fontSize: 13, flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                    title={isPreviewing ? "Stop preview" : "Play preview"}
                  >
                    {isPreviewing ? "■" : "▶"}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name}</div>
                    <div style={{ fontSize: 10, color: COLORS.textMuted, fontFamily: "monospace", marginTop: 2 }}>{v.id.slice(0, 20)}…</div>
                  </div>
                  {isSelected && <div style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS.purple, flexShrink: 0 }} />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, marginTop: 8 }}>
        {["log", "detail"].map((t) => (
          <div key={t} style={S.tab(activeTab === t)} onClick={() => setActiveTab(t)}>
            {t === "log" ? "Call Log" : "Session Detail"}
          </div>
        ))}
      </div>

      {activeTab === "log" && (
        <CallLogTable
          sessions={sessions}
          onSelect={(s) => { setSelected(s); setActiveTab("detail"); }}
        />
      )}

      {activeTab === "detail" && selected && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button type="button" style={{ ...S.btn("ghost"), alignSelf: "flex-start" }} onClick={() => setActiveTab("log")}>
              ← Back to Log
            </button>
            {selected.status !== "completed" && (
              <button type="button" style={{ ...S.btn("ghost"), padding: "4px 12px", fontSize: 12 }} onClick={() => fetchData(true)}>
                ↻ Refresh
              </button>
            )}
          </div>

          <div style={S.card}>
            <div style={S.cardHeader}>Call Info</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 16 }}>
              {selected.leadName && (
                <div>
                  <div style={{ fontSize: 11, color: COLORS.textMuted }}>Lead</div>
                  <div style={{ fontWeight: 600 }}>{selected.leadName}</div>
                </div>
              )}
              {selected.leadPhone && (
                <div>
                  <div style={{ fontSize: 11, color: COLORS.textMuted }}>Phone</div>
                  <div style={{ fontWeight: 600 }}>{selected.leadPhone}</div>
                </div>
              )}
              <div>
                <div style={{ fontSize: 11, color: COLORS.textMuted }}>Status</div>
                <span style={S.badge(STATUS_COLORS[selected.status] || COLORS.yellow)}>
                  {STATUS_LABELS[selected.status] || selected.status || "—"}
                </span>
              </div>
              <div>
                <div style={{ fontSize: 11, color: COLORS.textMuted }}>Outcome</div>
                {selected.outcome
                  ? <span style={S.badge(OUTCOME_COLORS[selected.outcome] || COLORS.textMuted)}>{selected.outcome}</span>
                  : <span style={{ color: COLORS.textMuted }}>—</span>}
              </div>
              <div>
                <div style={{ fontSize: 11, color: COLORS.textMuted }}>Duration</div>
                <div style={{ fontWeight: 600 }}>
                  {selected.durationSeconds != null
                    ? `${Math.floor(selected.durationSeconds / 60)}m ${selected.durationSeconds % 60}s`
                    : "—"}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: COLORS.textMuted }}>Started</div>
                <div style={{ fontWeight: 600 }}>
                  {selected.startedAt ? new Date(selected.startedAt).toLocaleString() : "—"}
                </div>
              </div>
            </div>
          </div>

          <RecordingPlayer url={selected.recordingUrl} />
          <TranscriptViewer transcript={selected.transcript} summary={selected.aiSummary} />
        </div>
      )}

      {activeTab === "detail" && !selected && (
        <div style={{ textAlign: "center", color: COLORS.textMuted, padding: 60 }}>
          Select a call from the log to view details.
        </div>
      )}
    </div>
  );
}
