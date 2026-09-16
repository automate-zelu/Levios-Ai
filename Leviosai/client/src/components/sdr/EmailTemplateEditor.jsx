import { useState } from "react";
import { COLORS, S } from "../../theme.js";
import { TemplateVariableField } from "./TemplateVariableField.jsx";
import { renderTemplatePreview } from "./templateVars.js";
import "./template-preview.css";

export function EmailTemplateEditor({ subject, body, onSubjectChange, onBodyChange, bare = false }) {
  const [preview, setPreview] = useState(false);
  const previewSubject = renderTemplatePreview(subject || "");
  const previewBody = renderTemplatePreview(body || "");

  return (
    <div style={bare ? undefined : S.card}>
      <div style={bare ? { display: "flex", justifyContent: "flex-end", marginBottom: 10 } : S.cardHeader}>
        {!bare && <span>Email Follow-up Template</span>}
        <button
          type="button"
          className={bare ? "sdr-agent-btn sdr-agent-btn--ghost" : undefined}
          style={bare ? { padding: "6px 12px" } : { ...S.btn("ghost"), padding: "4px 12px", fontSize: 12 }}
          onClick={() => setPreview((p) => !p)}
        >
          {preview ? "Edit" : "Preview"}
        </button>
      </div>

      {preview ? (
        <div className="sdr-agent-preview">
          <div className="sdr-agent-preview-field">
            <span className="sdr-agent-preview-kicker">Subject</span>
            <div className="sdr-agent-preview-subject">{previewSubject || "—"}</div>
          </div>
          <div className="sdr-agent-preview-field">
            <span className="sdr-agent-preview-kicker">Body</span>
            <div className="sdr-agent-preview-body">{previewBody || "—"}</div>
          </div>
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
