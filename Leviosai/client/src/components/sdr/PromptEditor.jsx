import { COLORS, S } from "../../theme.js";
import {
  CALENDAR_TOOL_CHIPS,
  appendToolSnippet,
  hasCalendarPromptBlock,
  injectCalendarPromptBlock,
} from "../../lib/calendarPrompt.js";

/**
 * AI system prompt editor with clickable calendar-tool chips
 * (same interaction model as SMS @variable chips).
 */
export function PromptEditor({ value, onChange, calendarContext = null }) {
  const toolsInPrompt = hasCalendarPromptBlock(value);

  const handleChip = (chip) => {
    if (chip.id === "full_block") {
      onChange(
        injectCalendarPromptBlock(value, {
          provider: calendarContext?.provider || "google",
          accountEmail: calendarContext?.accountEmail,
          prefs: calendarContext?.prefs,
          timezone: calendarContext?.prefs?.timezone || calendarContext?.timezone,
        })
      );
      return;
    }
    if (chip.snippet) {
      onChange(appendToolSnippet(value, chip.snippet));
    }
  };

  return (
    <div style={S.card}>
      <div style={S.cardHeader}>
        <span>AI System Prompt</span>
        {toolsInPrompt && (
          <span style={{ ...S.badge(COLORS.green), fontSize: 10 }}>Calendar tools enabled</span>
        )}
      </div>
      <p style={{ color: COLORS.textMuted, fontSize: 12, marginBottom: 10, lineHeight: 1.5 }}>
        Define persona, tone, and objections. Click a chip to add calendar booking instructions —
        live call tools only activate when the prompt includes the calendar tools block.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12, alignItems: "center" }}>
        {CALENDAR_TOOL_CHIPS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            title={chip.hint}
            onClick={() => handleChip(chip)}
            style={{
              ...S.btn(chip.id === "full_block" ? "secondary" : "ghost"),
              padding: "6px 12px",
              fontSize: 12,
              borderRadius: 20,
              cursor: "pointer",
            }}
          >
            @{chip.label}
          </button>
        ))}
      </div>
      {!toolsInPrompt && (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 8,
            background: COLORS.orangeGlow,
            border: `1px solid ${COLORS.orange}44`,
            fontSize: 12,
            color: COLORS.text,
            lineHeight: 1.45,
          }}
        >
          Calendar tools are off until you click <strong>@Full calendar tools block</strong> (or enable them in the panel below), then save configuration.
        </div>
      )}
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
