import { useMemo, useRef, useState } from "react";
import { COLORS, S } from "../../theme.js";
import { sdrApi } from "../../api.js";

/** Match server `--- Source: filename ---` upload markers. */
function listKbFilenames(kb) {
  const names = [];
  const re = /--- Source: (.+?) ---/g;
  let m;
  while ((m = re.exec(kb || ""))) {
    const name = (m[1] || "").trim();
    if (name) names.push(name);
  }
  return names;
}

export function KnowledgeBaseInput({ value, onChange, saving, onSave, bare = false }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState("");
  const [uploadMsg, setUploadMsg] = useState("");

  const files = useMemo(() => listKbFilenames(value), [value]);

  const handleFiles = async (fileList) => {
    const picked = Array.from(fileList || []);
    if (!picked.length) return;
    setUploading(true);
    setUploadMsg("");
    try {
      const result = await sdrApi.uploadKb(picked);
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

  const handleRemove = async (filename) => {
    if (!filename || removing) return;
    if (!confirm(`Remove “${filename}” from the knowledge base? Its extracted text will be deleted and search index rebuilt.`)) {
      return;
    }
    setRemoving(filename);
    setUploadMsg("");
    try {
      const result = await sdrApi.removeKbSource(filename);
      if (typeof result.knowledgeBase === "string") onChange(result.knowledgeBase);
      setUploadMsg(
        result.kbEmbedError
          ? `Removed ${filename}, but embeddings failed: ${result.kbEmbedError}`
          : `Removed ${filename}${result.kbChunks != null ? ` · ${result.kbChunks} chunks indexed` : ""}.`
      );
    } catch (e) {
      setUploadMsg(e.message || "Could not remove file");
    } finally {
      setRemoving("");
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
        Industry differences (solar, HVAC, roofing, etc.) belong here — same agent UI, different knowledge.
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
          disabled={uploading || !!removing}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? "Extracting…" : "Upload PDF or Word"}
        </button>
        <span style={{ fontSize: 11, color: COLORS.textDim }}>PDF, DOC, DOCX, TXT, MD · max 12 MB each</span>
      </div>

      {files.length > 0 && (
        <ul
          aria-label="Uploaded knowledge files"
          style={{
            listStyle: "none",
            margin: "0 0 12px",
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {files.map((name) => (
            <li
              key={name}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 12px",
                borderRadius: 10,
                border: `1px solid ${COLORS.border}`,
                background: COLORS.surfaceAlt || "rgba(255,255,255,0.03)",
              }}
            >
              <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 10 }}>
                <span aria-hidden style={{ fontSize: 16 }}>📄</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {name}
                  </div>
                  <div style={{ fontSize: 11, color: COLORS.textMuted }}>Indexed for live calls</div>
                </div>
              </div>
              <button
                type="button"
                className={bare ? "sdr-agent-btn sdr-agent-btn--ghost" : undefined}
                style={bare ? { flexShrink: 0 } : { ...S.btn("ghost"), padding: "6px 12px", fontSize: 12, flexShrink: 0, color: COLORS.red }}
                disabled={uploading || removing === name}
                onClick={() => handleRemove(name)}
              >
                {removing === name ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}

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
