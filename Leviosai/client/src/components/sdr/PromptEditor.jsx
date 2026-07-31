import { COLORS, S } from "../../theme.js";

export function PromptEditor({ value, onChange }) {
  return (
    <div style={S.card}>
      <div style={S.cardHeader}>AI System Prompt</div>
      <p style={{ color: COLORS.textMuted, fontSize: 12, marginBottom: 10 }}>
        Define your AI&apos;s persona, tone, and objectives. Include your company name, product, and how to handle objections.
      </p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...S.input, minHeight: 140, resize: "vertical" }}
        placeholder="You are Alex, a friendly AI sales representative…"
        aria-label="AI system prompt"
      />
      <div style={{ fontSize: 11, color: COLORS.textMuted, textAlign: "right", marginTop: 4 }}>
        {value?.length || 0} chars
      </div>
    </div>
  );
}
