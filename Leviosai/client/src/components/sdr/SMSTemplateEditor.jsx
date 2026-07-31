import { COLORS, S } from "../../theme.js";

export function SMSTemplateEditor({ value, onChange }) {
  const over = (value?.length || 0) > 160;
  const preview = (value || "").replace(/\{\{lead_name\}\}/gi, "Alex");

  return (
    <div style={S.card}>
      <div style={S.cardHeader}>SMS Follow-up Template</div>
      <input
        style={{ ...S.input, marginBottom: 8 }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Hi {{lead_name}}, this is Alex from…"
        aria-label="SMS template"
      />
      <div style={{ fontSize: 11, color: over ? COLORS.red : COLORS.textMuted, textAlign: "right" }}>
        {value?.length || 0}/160 {over && "⚠ Will split into multiple messages"}
      </div>
      <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 4 }}>
        Use <code style={{ background: COLORS.surfaceAlt, padding: "1px 4px", borderRadius: 3 }}>{"{{lead_name}}"}</code> for personalization
      </div>
      {value?.trim() && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: COLORS.surfaceAlt, border: `1px solid ${COLORS.border}` }}>
          <div style={{ fontSize: 10, color: COLORS.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Live preview</div>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>{preview}</div>
        </div>
      )}
    </div>
  );
}
