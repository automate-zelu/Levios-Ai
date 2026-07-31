import { COLORS, S } from "../../theme.js";

export function RecordingPlayer({ url }) {
  if (!url) return null;
  return (
    <div style={S.card}>
      <div style={S.cardHeader}>Recording</div>
      <audio controls src={url} style={{ width: "100%" }} preload="metadata">
        Your browser does not support audio playback.
      </audio>
      <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 8 }}>
        <a href={url} target="_blank" rel="noreferrer" style={{ color: COLORS.blue }}>
          Open recording
        </a>
      </div>
    </div>
  );
}
