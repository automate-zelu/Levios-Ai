import { useEffect, useRef, useState } from "react";
import { COLORS, S, formatDuration } from "../theme.js";
import { callApi, getToken } from "../api.js";
import { TranscriptViewer } from "../components/calling/TranscriptViewer.jsx";

/**
 * Live Calls — only truly live/ringing sessions.
 * Click a row → modal with realtime lead + agent transcript.
 */
export default function LiveCallsPage() {
  const [calls, setCalls] = useState([]);
  const [modalCall, setModalCall] = useState(null); // list row
  const [detail, setDetail] = useState(null);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [conn, setConn] = useState("idle");
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const abortRef = useRef(null);
  const bottomRef = useRef(null);
  const modalId = modalCall?.id || null;

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const refreshList = async (silent = false) => {
    try {
      const res = await callApi.getLive();
      setCalls(res?.data || []);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load live calls");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    refreshList();
    const t = setInterval(() => refreshList(true), 2000);
    return () => clearInterval(t);
  }, []);

  // Close modal if the call drops off the live list (optional keep-open while streaming ends)
  useEffect(() => {
    if (!modalId) return;
    const stillListed = calls.some((c) => c.id === modalId);
    if (!stillListed && conn === "ended") {
      // keep modal open with final transcript until user closes
    }
  }, [calls, modalId, conn]);

  useEffect(() => {
    if (!modalId) {
      setDetail(null);
      setLines([]);
      setConn("idle");
      return;
    }

    let cancelled = false;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLines([]);
    setDetail(null);
    setConn("live");

    (async () => {
      try {
        const snap = await callApi.getLiveSession(modalId);
        if (cancelled) return;
        setDetail(snap);
        setLines(snap?.lines || []);
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load call");
      }

      try {
        const token = getToken();
        const res = await fetch(`/api/call/live/${modalId}/events`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: ac.signal,
        });
        if (!res.ok || !res.body) throw new Error("Live stream unavailable");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const chunks = buf.split("\n\n");
          buf = chunks.pop() || "";
          for (const chunk of chunks) {
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              if (cancelled) continue;
              if (evt.type === "snapshot" || evt.type === "line" || evt.type === "ended") {
                if (Array.isArray(evt.lines)) setLines(evt.lines);
                if (evt.status) {
                  setDetail((d) => (d ? { ...d, status: evt.status } : d));
                }
                if (evt.type === "ended") setConn("ended");
              } else if (evt.type === "status") {
                setDetail((d) => (d ? { ...d, status: evt.status } : d));
              }
            } catch { /* ignore */ }
          }
        }
        if (!cancelled) setConn((c) => (c === "ended" ? c : "ended"));
      } catch (err) {
        if (ac.signal.aborted || cancelled) return;
        setConn("polling");
        const poll = setInterval(async () => {
          try {
            const snap = await callApi.getLiveSession(modalId);
            if (cancelled) return;
            setDetail(snap);
            setLines(snap?.lines || []);
            if (!snap?.live || snap?.status === "completed") {
              clearInterval(poll);
              setConn("ended");
            }
          } catch { /* keep polling */ }
        }, 1000);
        ac.signal.addEventListener("abort", () => clearInterval(poll));
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [modalId]);

  useEffect(() => {
    if (modalId) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines.length, modalId]);

  const startedMs = detail?.startedAt
    ? new Date(detail.startedAt).getTime()
    : modalCall?.startedAt
      ? new Date(modalCall.startedAt).getTime()
      : null;
  const elapsedSec = startedMs ? Math.max(0, Math.floor((Date.now() - startedMs) / 1000)) : null;
  void tick;

  const closeModal = () => {
    abortRef.current?.abort();
    setModalCall(null);
  };

  if (loading) {
    return <div style={{ padding: 40, color: COLORS.textMuted }}>Loading live calls…</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: COLORS.orange, fontWeight: 700, marginBottom: 6 }}>
            AI Calling
          </div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, fontFamily: "Outfit, DM Sans, sans-serif" }}>
            Live Calls
          </h1>
          <p style={{ margin: "8px 0 0", color: COLORS.textMuted, fontSize: 14, maxWidth: 540 }}>
            Only calls that are ringing or in progress. Click a call to open the live transcript.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={S.badge(calls.length ? COLORS.green : COLORS.textMuted)}>
            {calls.length} live
          </span>
          <button type="button" style={S.btn("secondary")} onClick={() => refreshList(true)}>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          background: `${COLORS.red}18`,
          border: `1px solid ${COLORS.red}44`,
          color: COLORS.red,
          padding: "10px 14px",
          borderRadius: 10,
          fontSize: 13,
        }}>
          {error}
        </div>
      )}

      <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
        <div style={{
          padding: "14px 18px",
          borderBottom: `1px solid ${COLORS.border}`,
          fontSize: 12,
          fontWeight: 600,
          color: COLORS.textMuted,
          textTransform: "uppercase",
          letterSpacing: 0.6,
        }}>
          Active now
        </div>

        {!calls.length ? (
          <div style={{ padding: "48px 24px", textAlign: "center", color: COLORS.textMuted, fontSize: 14, lineHeight: 1.6 }}>
            No live calls right now.
            <div style={{ marginTop: 6, fontSize: 13, color: COLORS.textDim }}>
              Place a call from Leads — it will show here while ringing and during the conversation.
            </div>
          </div>
        ) : (
          <div>
            {calls.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setModalCall(c)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  borderBottom: `1px solid ${COLORS.border}55`,
                  background: "transparent",
                  padding: "16px 18px",
                  cursor: "pointer",
                  color: COLORS.text,
                  fontFamily: "inherit",
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 12,
                  alignItems: "center",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = COLORS.surfaceAlt; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: c.status === "active" ? COLORS.green : COLORS.yellow,
                      boxShadow: c.status === "active" ? `0 0 0 4px ${COLORS.green}22` : "none",
                    }} />
                    <span style={{ fontWeight: 650, fontSize: 15 }}>
                      {c.leadName || "Unknown lead"}
                    </span>
                    <span style={S.badge(statusColor(c.status))}>{prettyStatus(c.status)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: COLORS.textMuted, paddingLeft: 18 }}>
                    {c.leadPhone || "—"}
                    {c.lineCount ? ` · ${c.lineCount} line${c.lineCount === 1 ? "" : "s"}` : ""}
                  </div>
                  {c.preview?.text && (
                    <div style={{
                      marginTop: 8,
                      marginLeft: 18,
                      fontSize: 12,
                      color: COLORS.textDim,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: 560,
                    }}>
                      <span style={{ color: c.preview.speaker === "ai" ? COLORS.orange : COLORS.blue, fontWeight: 600 }}>
                        {c.preview.speaker === "ai" ? "Agent" : "Lead"}:
                      </span>{" "}
                      {c.preview.text}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 12, color: COLORS.orange, fontWeight: 600 }}>
                  Open transcript →
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Live transcript modal */}
      {modalCall && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1200,
            backdropFilter: "blur(4px)",
            padding: 16,
          }}
          onClick={closeModal}
        >
          <div
            style={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 16,
              width: "min(720px, 100%)",
              maxHeight: "90vh",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              padding: "16px 20px",
              borderBottom: `1px solid ${COLORS.border}`,
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "flex-start",
            }}>
              <div>
                <div style={{ fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: COLORS.orange, fontWeight: 700, marginBottom: 4 }}>
                  Live transcript
                </div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>
                  {detail?.leadName || modalCall.leadName || "Call"}
                </div>
                <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 4 }}>
                  {detail?.leadPhone || modalCall.leadPhone || "—"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <span style={S.badge(statusColor(detail?.status || modalCall.status))}>
                  {prettyStatus(detail?.status || modalCall.status)}
                </span>
                <span style={S.badge(conn === "live" ? COLORS.green : conn === "polling" ? COLORS.yellow : COLORS.textMuted)}>
                  {conn === "live" ? "Streaming" : conn === "polling" ? "Updating…" : conn === "ended" ? "Ended" : "Idle"}
                </span>
                {elapsedSec != null && (
                  <span style={{ fontSize: 12, color: COLORS.textMuted }}>{formatDuration(elapsedSec)}</span>
                )}
                <button type="button" style={{ ...S.btn("ghost"), padding: "6px 10px" }} onClick={closeModal} aria-label="Close">
                  ✕
                </button>
              </div>
            </div>

            <div style={{ padding: "8px 16px 16px", overflowY: "auto", flex: 1, minHeight: 280 }}>
              <TranscriptViewer
                lines={lines}
                live={conn === "live" || conn === "polling"}
                maxHeight={480}
                summary={conn === "ended" ? detail?.aiSummary : null}
              />
              <div ref={bottomRef} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function prettyStatus(status) {
  if (!status) return "Unknown";
  if (status === "active") return "In call";
  if (status === "initiated") return "Ringing";
  return String(status).replace(/_/g, " ");
}

function statusColor(status) {
  if (status === "active") return COLORS.green;
  if (status === "initiated") return COLORS.yellow;
  if (status === "completed") return COLORS.textMuted;
  return COLORS.blue;
}
