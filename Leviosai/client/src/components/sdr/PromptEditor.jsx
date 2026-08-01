import { COLORS, S } from "../../theme.js";
import { CALENDAR_TOOL_CHIPS } from "../../lib/calendarPrompt.js";

export function PromptEditor({ value, onChange }) {
  return (
    <div style={S.card}>
      <div style={S.cardHeader}>AI System Prompt</div>
      <p style={{ color: COLORS.textMuted, fontSize: 12, marginBottom: 10 }}>
        Define your AI&apos;s persona, tone, and objectives. Include your company name, product, and how to handle objections.
        Use the Calendar tools panel below to insert check_availability / book_appointment instructions (same chip pattern as SMS variables).
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {CALENDAR_TOOL_CHIPS.filter((c) => c.id !== "full_block").map((chip) => (
          <span
            key={chip.id}
            style={{
              fontSize: 11,
              padding: "3px 10px",
              borderRadius: 20,
              border: `1px solid ${COLORS.border}`,
              color: COLORS.textMuted,
            }}
            title={chip.hint}
          >
            @{chip.label}
          </span>
        ))}
        <span style={{ fontSize: 11, color: COLORS.textDim, alignSelf: "center" }}>
          → configure in Calendar tools below
        </span>
      </div>
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
