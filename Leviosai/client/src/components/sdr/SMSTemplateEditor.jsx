import { COLORS, S } from "../../theme.js";
import { TemplateVariableField } from "./TemplateVariableField.jsx";
import { renderTemplatePreview } from "./templateVars.js";

export function SMSTemplateEditor({ value, onChange }) {
  const over = (value?.length || 0) > 160;
  const preview = renderTemplatePreview(value || "");

  return (
    <div style={S.card}>
      <div style={S.cardHeader}>SMS Follow-up Template</div>
      <TemplateVariableField
        value={value}
        onChange={onChange}
        ariaLabel="SMS template"
        placeholder="Hi @Lead first name — type @ to insert variables"
      />
      <div style={{ fontSize: 11, color: over ? COLORS.red : COLORS.textMuted, textAlign: "right", marginTop: 4 }}>
        {value?.length || 0}/160 {over && "⚠ Will split into multiple messages"}
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
