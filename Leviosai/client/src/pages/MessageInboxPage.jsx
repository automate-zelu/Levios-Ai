import { useEffect, useMemo, useState } from "react";
import { COLORS, S } from "../theme.js";
import { messagesApi, leadsApi } from "../api.js";

/**
 * Dedicated SMS or Email inbox — chat-style threads like a messaging web view.
 * channel: "sms" | "email"
 */
export default function MessageInboxPage({ channel }) {
  const isSms = channel === "sms";
  const title = isSms ? "SMS Inbox" : "Email Inbox";
  const subtitle = isSms
    ? "All SDR SMS conversations with leads — outbound follow-ups and their replies"
    : "All SDR email conversations with leads — follow-ups and replies";

  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [query, setQuery] = useState("");

  const loadThreads = () => {
    setLoading(true);
    setError("");
    messagesApi
      .threads(channel, 80)
      .then((data) => {
        const list = data.threads || [];
        setThreads(list);
        if (!selectedLeadId && list.length > 0) {
          setSelectedLeadId(list[0].leadId);
        }
      })
      .catch((e) => setError(e.message || "Failed to load conversations"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setSelectedLeadId(null);
    setMessages([]);
    loadThreads();
  }, [channel]);

  useEffect(() => {
    if (!selectedLeadId) {
      setMessages([]);
      return;
    }
    setThreadLoading(true);
    leadsApi
      .getMessages(selectedLeadId)
      .then((rows) => {
        const filtered = (rows || []).filter((m) => m.channel === channel);
        setMessages(filtered);
      })
      .catch((e) => setError(e.message || "Failed to load thread"))
      .finally(() => setThreadLoading(false));
  }, [selectedLeadId, channel]);

  const filteredThreads = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => {
      const name = `${t.leadFirstName || ""} ${t.leadLastName || ""}`.toLowerCase();
      const contact = `${t.leadEmail || ""} ${t.leadPhone || ""}`.toLowerCase();
      const preview = (t.lastMessage?.content || "").toLowerCase();
      return name.includes(q) || contact.includes(q) || preview.includes(q);
    });
  }, [threads, query]);

  const selected = threads.find((t) => t.leadId === selectedLeadId) || null;
  const selectedName = selected
    ? [selected.leadFirstName, selected.leadLastName].filter(Boolean).join(" ") || `Lead #${selected.leadId}`
    : "";

  return (
    <div>
      <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{title}</h2>
          <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "4px 0 0", maxWidth: 640 }}>{subtitle}</p>
        </div>
        <button type="button" style={{ ...S.btn("ghost"), padding: "8px 14px", fontSize: 12 }} onClick={loadThreads}>
          Refresh
        </button>
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 8, background: `${COLORS.red}18`, color: COLORS.red, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(260px, 340px) 1fr",
          gap: 0,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
          overflow: "hidden",
          minHeight: "min(70vh, 640px)",
          background: COLORS.surface,
        }}
        className="message-inbox-grid"
      >
        {/* Thread list */}
        <div style={{ borderRight: `1px solid ${COLORS.border}`, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: 12, borderBottom: `1px solid ${COLORS.border}` }}>
            <input
              style={{ ...S.input, width: "100%" }}
              placeholder={isSms ? "Search name or phone…" : "Search name or email…"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {loading ? (
              <div style={{ padding: 24, color: COLORS.textMuted, fontSize: 13, textAlign: "center" }}>Loading conversations…</div>
            ) : filteredThreads.length === 0 ? (
              <div style={{ padding: 28, color: COLORS.textMuted, fontSize: 13, textAlign: "center", lineHeight: 1.5 }}>
                No {isSms ? "SMS" : "email"} conversations yet.
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  They appear here when the SDR sequence sends a follow-up or a lead replies.
                </div>
              </div>
            ) : (
              filteredThreads.map((t) => {
                const name = [t.leadFirstName, t.leadLastName].filter(Boolean).join(" ") || `Lead #${t.leadId}`;
                const contact = isSms ? t.leadPhone : t.leadEmail;
                const active = t.leadId === selectedLeadId;
                const preview = (t.lastMessage?.content || "").replace(/\s+/g, " ").slice(0, 80);
                return (
                  <button
                    key={t.leadId}
                    type="button"
                    onClick={() => setSelectedLeadId(t.leadId)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "12px 14px",
                      border: "none",
                      borderBottom: `1px solid ${COLORS.border}55`,
                      background: active ? `${COLORS.orange}14` : "transparent",
                      cursor: "pointer",
                      color: "inherit",
                      fontFamily: "inherit",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontWeight: 650, fontSize: 13 }}>{name}</span>
                      <span style={{ fontSize: 10, color: COLORS.textDim, flexShrink: 0 }}>
                        {t.lastMessage?.createdAt ? new Date(t.lastMessage.createdAt).toLocaleString() : ""}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 4 }}>{contact || "—"}</div>
                    <div style={{ fontSize: 12, color: COLORS.textDim, lineHeight: 1.4 }}>
                      {t.lastMessage?.direction === "inbound" ? "← " : "→ "}
                      {preview || "(empty)"}
                      {t.messageCount > 1 ? ` · ${t.messageCount} msgs` : ""}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Chat pane */}
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, background: COLORS.bg }}>
          {!selected ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.textMuted, fontSize: 13, padding: 24 }}>
              Select a conversation to view the thread
            </div>
          ) : (
            <>
              <div
                style={{
                  padding: "14px 18px",
                  borderBottom: `1px solid ${COLORS.border}`,
                  background: COLORS.surface,
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{selectedName}</div>
                  <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 2 }}>
                    {isSms ? selected.leadPhone : selected.leadEmail}
                    {" · "}
                    {isSms ? "SMS" : "Email"} thread
                  </div>
                </div>
                <span style={S.badge(isSms ? COLORS.orange : COLORS.purple)}>
                  {messages.length} message{messages.length === 1 ? "" : "s"}
                </span>
              </div>

              <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>
                {threadLoading ? (
                  <div style={{ color: COLORS.textMuted, fontSize: 13, textAlign: "center", padding: 40 }}>Loading messages…</div>
                ) : messages.length === 0 ? (
                  <div style={{ color: COLORS.textMuted, fontSize: 13, textAlign: "center", padding: 40 }}>No messages in this thread.</div>
                ) : (
                  messages.map((m) => {
                    const inbound = m.direction === "inbound";
                    return (
                      <div
                        key={m.id}
                        style={{
                          display: "flex",
                          justifyContent: inbound ? "flex-start" : "flex-end",
                          marginBottom: 12,
                        }}
                      >
                        <div
                          style={{
                            maxWidth: "78%",
                            padding: "10px 14px",
                            borderRadius: 12,
                            background: inbound ? COLORS.surfaceAlt : `${COLORS.orange}18`,
                            border: `1px solid ${inbound ? COLORS.border : `${COLORS.orange}44`}`,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 10,
                              fontWeight: 650,
                              color: inbound ? COLORS.blue : COLORS.orange,
                              marginBottom: 4,
                              textTransform: "uppercase",
                              letterSpacing: 0.4,
                            }}
                          >
                            {inbound ? `👤 ${selectedName}` : m.aiGenerated ? "🤖 SDR AI" : "→ You"}
                            {" · "}
                            {m.createdAt ? new Date(m.createdAt).toLocaleString() : ""}
                          </div>
                          <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                            {m.content}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .message-inbox-grid {
            grid-template-columns: 1fr !important;
            min-height: auto !important;
          }
          .message-inbox-grid > div:first-child {
            max-height: 280px;
            border-right: none !important;
            border-bottom: 1px solid ${COLORS.border};
          }
          .message-inbox-grid > div:last-child {
            min-height: 420px;
          }
        }
      `}</style>
    </div>
  );
}
