import { COLORS, S } from "../../theme.js";

export function KnowledgeBaseInput({ value, onChange, saving }) {
  return (
    <div style={S.card}>
      <div style={S.cardHeader}>
        <span>Knowledge Base</span>
        {saving ? (
          <span style={{ fontSize: 11, color: COLORS.yellow }}>Saving…</span>
        ) : value?.trim() ? (
          <span style={{ fontSize: 11, color: COLORS.green }}>Ready for RAG</span>
        ) : null}
      </div>
      <p style={{ color: COLORS.textMuted, fontSize: 12, marginBottom: 10 }}>
        Business info, FAQs, pricing, and talking points. Retrieved by AI during live calls via similarity search.
      </p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...S.input, minHeight: 120, resize: "vertical" }}
        placeholder={"Company: …\nServices: …\nPricing: …"}
        aria-label="Knowledge base"
      />
    </div>
  );
}
