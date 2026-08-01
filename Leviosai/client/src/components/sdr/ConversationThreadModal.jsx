import { useEffect, useMemo, useState } from "react";
import { COLORS, S } from "../../theme.js";
import { parseEmailContent } from "../../lib/emailMessage.js";

/**
 * Modal showing SMS or Email conversation for a lead, with link to full inbox.
 */
export function ConversationThreadModal({
  channel = "sms",
  leadName = "",
  leadPhone = "",
  leadEmail = "",
  messages = [],
  onClose,
  onOpenInbox,
}) {
  const isSms = channel === "sms";
  const filtered = useMemo(
    () => (messages || []).filter((m) => m.channel === channel),
    [messages, channel]
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isSms ? "SMS conversation" : "Email conversation"}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.72)",
        zIndex: 1200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          maxHeight: "min(80vh, 720px)",
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 14,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 64px rgba(0,0,0,0.45)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "16px 18px",
            borderBottom: `1px solid ${COLORS.border}`,
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "flex-start",
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
              {isSms ? "SMS thread" : "Email thread"}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{leadName || "Lead"}</div>
            <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 4 }}>
              {isSms ? leadPhone || "—" : leadEmail || "—"}
              {" · "}
              {filtered.length} message{filtered.length === 1 ? "" : "s"}
            </div>
          </div>
          <button type="button" style={{ ...S.btn("ghost"), padding: "6px 10px" }} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 16, background: COLORS.bg }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: "center", color: COLORS.textMuted, fontSize: 13, padding: 40 }}>
              No {isSms ? "SMS" : "email"} messages yet for this lead.
            </div>
          ) : (
            filtered.map((m) => {
              const inbound = m.direction === "inbound";
              if (!isSms) {
                const { subject, body } = parseEmailContent(m.content);
                return (
                  <article
                    key={m.id}
                    style={{
                      marginBottom: 12,
                      borderRadius: 10,
                      border: `1px solid ${COLORS.border}`,
                      background: COLORS.surface,
                      overflow: "hidden",
                    }}
                  >
                    <div style={{ padding: "10px 12px", borderBottom: `1px solid ${COLORS.border}`, background: COLORS.surfaceAlt, display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={S.badge(inbound ? COLORS.blue : COLORS.purple)}>
                        {inbound ? "Inbound" : m.aiGenerated ? "Outbound · AI" : "Outbound"}
                      </span>
                      <span style={{ fontSize: 11, color: COLORS.textMuted }}>
                        {m.createdAt ? new Date(m.createdAt).toLocaleString() : ""}
                      </span>
                    </div>
                    <div style={{ padding: "12px 14px" }}>
                      <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 2 }}>Subject</div>
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{subject || "(no subject)"}</div>
                      <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{body || "(empty)"}</div>
                    </div>
                  </article>
                );
              }
              return (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    justifyContent: inbound ? "flex-start" : "flex-end",
                    marginBottom: 10,
                  }}
                >
                  <div
                    style={{
                      maxWidth: "82%",
                      padding: "10px 12px",
                      borderRadius: 12,
                      background: inbound ? COLORS.surfaceAlt : `${COLORS.orange}18`,
                      border: `1px solid ${inbound ? COLORS.border : `${COLORS.orange}44`}`,
                    }}
                  >
                    <div style={{ fontSize: 10, color: COLORS.textMuted, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 }}>
                      {inbound ? leadName || "Lead" : m.aiGenerated ? "SDR AI" : "You"}
                      {" · "}
                      {m.createdAt ? new Date(m.createdAt).toLocaleString() : ""}
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{m.content}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div
          style={{
            padding: "12px 16px",
            borderTop: `1px solid ${COLORS.border}`,
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <button type="button" style={S.btn("ghost")} onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            style={S.btn("primary")}
            onClick={() => onOpenInbox?.(channel)}
          >
            Open {isSms ? "SMS Inbox" : "Email Inbox"} →
          </button>
        </div>
      </div>
    </div>
  );
}
