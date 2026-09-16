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
export function PromptEditor({ value, onChange, calendarContext = null, onSave, saving, bare = false }) {
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
    <div style={bare ? undefined : S.card}>
      {!bare && (
        <div style={S.cardHeader}>
          <span>AI System Prompt</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {toolsInPrompt && (
              <span style={{ ...S.badge(COLORS.green), fontSize: 10 }}>Calendar tools enabled</span>
            )}
            {onSave && (
              <button
                type="button"
                style={{ ...S.btn("primary"), padding: "7px 14px", fontSize: 12 }}
                onClick={onSave}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            )}
          </div>
        </div>
      )}
      {bare && toolsInPrompt && (
        <div style={{ marginBottom: 12 }}>
          <span style={{ ...S.badge(COLORS.green), fontSize: 10 }}>Calendar tools in prompt</span>
        </div>
      )}
      <p className={bare ? "sdr-agent-help" : undefined} style={bare ? undefined : { color: COLORS.textMuted, fontSize: 12, marginBottom: 10, lineHeight: 1.5 }}>
        Persona, tone, and objections. Chips add calendar instructions — live tools only run when the tools block is in the prompt.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12, alignItems: "center" }}>
        {CALENDAR_TOOL_CHIPS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            title={chip.hint}
            onClick={() => handleChip(chip)}
            className={bare ? `sdr-agent-chip${chip.id === "full_block" ? " sdr-agent-chip--on" : ""}` : undefined}
            style={bare ? undefined : {
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
        <div className={bare ? "sdr-agent-hint" : undefined} style={bare ? undefined : {
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 8,
            background: COLORS.orangeGlow,
            border: `1px solid ${COLORS.orange}44`,
            fontSize: 12,
            color: COLORS.text,
            lineHeight: 1.45,
          }}>
          Calendar tools stay off until you add <strong>@Full calendar tools block</strong> (or enable them on SDR Setup), then save.
        </div>
      )}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...S.input, minHeight: 180, resize: "vertical" }}
        placeholder="You are Alex, a friendly AI sales representative…"
        aria-label="AI system prompt"
      />
      <div className={bare ? "sdr-agent-meta" : undefined} style={bare ? undefined : { fontSize: 11, color: COLORS.textMuted, textAlign: "right", marginTop: 4 }}>
        {value?.length || 0} chars
      </div>
    </div>
  );
}
