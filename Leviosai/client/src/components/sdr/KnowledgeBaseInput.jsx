import { useRef, useState } from "react";
import { COLORS, S } from "../../theme.js";
import { sdrApi } from "../../api.js";

export function KnowledgeBaseInput({ value, onChange, saving, onSave, bare = false }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading(true);
    setUploadMsg("");
    try {
      const result = await sdrApi.uploadKb(files);
      if (typeof result.knowledgeBase === "string") onChange(result.knowledgeBase);
      const names = (result.uploaded || []).join(", ");
      setUploadMsg(
        result.kbEmbedError
          ? `Added ${names}, but embeddings failed: ${result.kbEmbedError}`
          : `Added ${names}${result.kbChunks != null ? ` · ${result.kbChunks} chunks indexed` : ""}.`
      );
    } catch (e) {
      setUploadMsg(e.message || "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div style={bare ? undefined : S.card}>
      {!bare && (
        <div style={S.cardHeader}>
          <span>Knowledge Base</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {saving ? (
              <span style={{ fontSize: 11, color: COLORS.yellow }}>Saving…</span>
            ) : value?.trim() ? (
              <span style={{ fontSize: 11, color: COLORS.green }}>Ready for RAG</span>
            ) : null}
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
      {bare && value?.trim() ? (
        <div style={{ marginBottom: 10 }}>
          <span style={{ ...S.badge(COLORS.green), fontSize: 10 }}>Ready for retrieval</span>
        </div>
      ) : null}
      <p className={bare ? "sdr-agent-help" : undefined} style={bare ? undefined : { color: COLORS.textMuted, fontSize: 12, marginBottom: 10 }}>
        Paste notes or upload PDF / Word / text. Uploads extract text and index it for live calls.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.doc,.docx,.txt,.md,.csv,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          multiple
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
        <button
          type="button"
          className={bare ? "sdr-agent-btn sdr-agent-btn--ghost" : undefined}
          style={bare ? undefined : { ...S.btn("secondary"), padding: "8px 14px", fontSize: 12 }}
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? "Extracting…" : "Upload PDF or Word"}
        </button>
        <span style={{ fontSize: 11, color: COLORS.textDim }}>PDF, DOC, DOCX, TXT, MD · max 12 MB each</span>
      </div>
      {uploadMsg && (
        <div className={bare ? "sdr-agent-help" : undefined} style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 10, lineHeight: 1.45 }}>
          {uploadMsg}
        </div>
      )}

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...S.input, minHeight: 140, resize: "vertical" }}
        placeholder={"Company: …\nServices: …\nPricing: …"}
        aria-label="Knowledge base"
      />
    </div>
  );
}