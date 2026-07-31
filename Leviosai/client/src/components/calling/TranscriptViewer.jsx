import { COLORS, S } from "../../theme.js";

export function TranscriptViewer({ transcript, summary }) {
  return (
    <>
      {summary && (
        <div style={S.card}>
          <div style={S.cardHeader}>AI Summary</div>
          <p style={{ color: COLORS.text, fontSize: 14, lineHeight: 1.6, margin: 0 }}>{summary}</p>
        </div>
      )}

      {transcript && (
        <div style={S.card}>
          <div style={S.cardHeader}>Transcript</div>
          <div style={{ maxHeight: 400, overflowY: "auto" }}>
            {transcript.split("\n").filter(Boolean).map((line, i) => {
              const isAI = line.startsWith("AI:");
              return (
                <div
                  key={i}
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
                      minWidth: 30,
                      textAlign: isAI ? "right" : "left",
                      paddingTop: 4,
                    }}
                  >
                    {isAI ? "AI" : "Lead"}
                  </div>
                  <div
                    style={{
                      background: isAI ? COLORS.orangeGlow : COLORS.surfaceAlt,
                      border: `1px solid ${isAI ? COLORS.orange + "33" : COLORS.border}`,
                      borderRadius: 10,
                      padding: "8px 14px",
                      maxWidth: "75%",
                      fontSize: 13,
                      lineHeight: 1.5,
                    }}
                  >
                    {line.replace(/^(AI|LEAD):\s*/, "")}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
