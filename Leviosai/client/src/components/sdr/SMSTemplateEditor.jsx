import { COLORS, S } from "../../theme.js";
import { TemplateVariableField } from "./TemplateVariableField.jsx";
import { renderTemplatePreview } from "./templateVars.js";
import "./template-preview.css";

export function SMSTemplateEditor({ value, onChange, bare = false }) {
  const over = (value?.length || 0) > 160;
  const preview = renderTemplatePreview(value || "");

  return (
    <div style={bare ? undefined : S.card}>
      {!bare && <div style={S.cardHeader}>SMS Follow-up Template</div>}
      <TemplateVariableField
        value={value}
        onChange={onChange}
        ariaLabel="SMS template"
        placeholder="Hi @Lead first name — type @ to insert variables"
      />
      <div className={bare ? "sdr-agent-meta" : undefined} style={bare ? { color: over ? COLORS.red : undefined } : { fontSize: 11, color: over ? COLORS.red : COLORS.textMuted, textAlign: "right", marginTop: 4 }}>
        {value?.length || 0}/160 {over && "Will split into multiple messages"}
      </div>
      {value?.trim() && (
        <div className="sdr-agent-preview">
          <small>Live preview</small>
          <div className="sdr-agent-preview-body">{preview}</div>
        </div>
      )}
    </div>
  );
}
