import { useState } from "react";
import { COLORS, S } from "../../theme.js";

export function EmailTemplateEditor({ subject, body, onSubjectChange, onBodyChange }) {
  const [preview, setPreview] = useState(false);
  const previewSubject = (subject || "").replace(/\{\{lead_name\}\}/gi, "Alex");
  const previewBody = (body || "").replace(/\{\{lead_name\}\}/gi, "Alex");

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
          <input
            style={{ ...S.input, marginBottom: 10 }}
            value={subject}
            onChange={(e) => onSubjectChange(e.target.value)}
            placeholder="Subject: Quick follow-up, {{lead_name}}"
            aria-label="Email subject"
          />
          <textarea
            value={body}
            onChange={(e) => onBodyChange(e.target.value)}
            style={{ ...S.input, minHeight: 120, resize: "vertical" }}
            placeholder={"Hi {{lead_name}},\n\nI tried to reach you…"}
            aria-label="Email body"
          />
        </>
      )}
    </div>
  );
}
