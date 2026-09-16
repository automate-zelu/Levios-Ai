import { COLORS, S } from "../../theme.js";

/**
 * Transcript viewer for both:
 * - structured lines: [{ speaker: "ai"|"lead", text, at }]
 * - legacy plain text: "AI: …\nLEAD: …"
 */
export function TranscriptViewer({ transcript, lines, summary, live = false, maxHeight = 400 }) {
  const parsed = normalizeLines(lines, transcript);

  return (
    <>
      {summary && (
        <div style={S.card}>
          <div style={S.cardHeader}>AI Summary</div>
          <p style={{ color: COLORS.text, fontSize: 14, lineHeight: 1.6, margin: 0 }}>{summary}</p>
        </div>
      )}

      <div style={{ ...S.card, marginBottom: live ? 0 : 20 }}>
        <div style={S.cardHeader}>
          <span>{live ? "Live transcript" : "Transcript"}</span>
          {live && (
            <span style={{ ...S.badge(COLORS.green), display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{
                width: 7, height: 7, borderRadius: "50%", background: COLORS.green,
                boxShadow: `0 0 0 0 ${COLORS.green}`,
                animation: "livePulse 1.6s ease-out infinite",
              }} />
              Live
            </span>
          )}
        </div>

        {!parsed.length ? (
          <div style={{ color: COLORS.textMuted, fontSize: 13, padding: "12px 0" }}>
            {live ? "Waiting for speech…" : "No transcript yet."}
          </div>
        ) : (
          <div style={{ maxHeight, overflowY: "auto", paddingRight: 4 }}>
            {parsed.map((line, i) => {
              const isAI = line.speaker === "ai";
              return (
                <div
                  key={`${line.at || 0}-${i}`}
                  style={{
                    display: "flex",
                    gap: 10,
                    marginBottom: 12,
                    flexDirection: isAI ? "row-reverse" : "row",
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      color: isAI ? COLORS.orange : COLORS.blue,
                      fontWeight: 700,
                      minWidth: 42,
                      textAlign: isAI ? "right" : "left",
                      paddingTop: 4,
                    }}
                  >
                    {isAI ? "Agent" : "Lead"}
                  </div>
                  <div
                    style={{
                      background: isAI ? COLORS.orangeGlow : COLORS.surfaceAlt,
                      border: `1px solid ${isAI ? COLORS.orange + "33" : COLORS.border}`,
                      borderRadius: 10,
                      padding: "8px 14px",
                      maxWidth: "78%",
                      fontSize: 13,
                      lineHeight: 1.5,
                    }}
                  >
                    {line.text}
                    {line.at ? (
                      <div style={{
                        marginTop: 6,
                        fontSize: 10,
                        color: COLORS.textDim,
                        textAlign: isAI ? "right" : "left",
                      }}>
                        {formatClock(line.at)}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {live && (
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: COLORS.textDim,
                fontSize: 12,
                padding: "4px 0 8px",
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%", background: COLORS.orange,
                  animation: "livePulse 1.2s ease-out infinite",
                }} />
                Listening…
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes livePulse {
          0% { box-shadow: 0 0 0 0 rgba(39,174,96,0.55); opacity: 1; }
          70% { box-shadow: 0 0 0 8px rgba(39,174,96,0); opacity: 0.85; }
          100% { box-shadow: 0 0 0 0 rgba(39,174,96,0); opacity: 1; }
        }
      `}</style>
    </>
  );
}

function normalizeLines(lines, transcript) {
  if (Array.isArray(lines) && lines.length) {
    return lines
      .filter((l) => l && (l.speaker === "ai" || l.speaker === "lead") && l.text)
      .map((l) => ({ speaker: l.speaker, text: String(l.text), at: l.at || 0 }));
  }
  if (!transcript) return [];
  if (typeof transcript !== "string") return [];
  try {
    const parsed = JSON.parse(transcript);
    if (Array.isArray(parsed)) return normalizeLines(parsed, null);
  } catch { /* plain text */ }
  return transcript
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({
      speaker: /^AI:/i.test(line) ? "ai" : "lead",
      text: line.replace(/^(AI|LEAD):\s*/i, ""),
      at: 0,
    }));
}

function formatClock(at) {
  try {
    return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}
