import { useState } from "react";
import { COLORS, S } from "../../theme.js";
import { TemplateVariableField } from "./TemplateVariableField.jsx";
import { renderTemplatePreview } from "./templateVars.js";

export function EmailTemplateEditor({ subject, body, onSubjectChange, onBodyChange }) {
  const [preview, setPreview] = useState(false);
  const previewSubject = renderTemplatePreview(subject || "");
  const previewBody = renderTemplatePreview(body || "");

  return (
    <div style={S.card}>
      <div style={S.cardHeader}>
        <span>Email Follow-up Template</span>
        <button
          type="button"
          style={{ ...S.btn("ghost"), padding: "4px 12px", fontSize: 12 }}
          onClick={() => setPreview((p) => !p)}
        >
          {preview ? "Edit" : "Preview"}
        </button>
      </div>

      {preview ? (
        <div style={{ padding: 16, borderRadius: 8, background: COLORS.surfaceAlt, border: `1px solid ${COLORS.border}` }}>
          <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 6 }}>Subject</div>
          <div style={{ fontWeight: 600, marginBottom: 14 }}>{previewSubject || "—"}</div>
          <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 6 }}>Body</div>
          <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{previewBody || "—"}</div>
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 6, fontWeight: 500 }}>Subject</div>
            <TemplateVariableField
              value={subject}
              onChange={onSubjectChange}
              ariaLabel="Email subject"
              placeholder="Checking in from @Your company"
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 6, fontWeight: 500 }}>Body</div>
            <TemplateVariableField
              multiline
              rows={6}
              value={body}
              onChange={onBodyChange}
              ariaLabel="Email body"
              placeholder={"Hi @Lead first name,\n\nI tried to reach you…"}
            />
          </div>
        </>
      )}
    </div>
  );
}
