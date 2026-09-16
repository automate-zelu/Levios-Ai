import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { COLORS, S } from "../theme.js";
import { messagesApi, leadsApi, messagingApi, aiApi } from "../api.js";
import { parseEmailContent, emailPreviewLine } from "../lib/emailMessage.js";
import "./message-inbox.css";

function initials(first, last, fallback) {
  const a = (first || "").trim()[0] || "";
  const b = (last || "").trim()[0] || "";
  const pair = `${a}${b}`.toUpperCase();
  if (pair) return pair;
  return String(fallback || "?").slice(0, 2).toUpperCase();
}

function formatRelative(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 45) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Dedicated SMS or Email inbox.
 * SMS = chat bubbles + reply composer; Email = subject / body mail layout.
 */
export default function MessageInboxPage({ channel }) {
  const navigate = useNavigate();
  const isSms = channel === "sms";
  const title = isSms ? "SMS Inbox" : "Email Inbox";
  const subtitle = isSms
    ? "SDR texts with leads — follow-ups, replies, and send from here."
    : "SDR email follow-ups and replies — subject, body, and thread view.";

  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const streamEndRef = useRef(null);

  const loadThreads = (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError("");
    }
    messagesApi
      .threads(channel, 80)
      .then((data) => {
        const list = data.threads || [];
        setThreads(list);
        if (silent) return;
        let focusId = null;
        try {
          focusId = sessionStorage.getItem("inboxFocusLeadId");
          if (focusId) sessionStorage.removeItem("inboxFocusLeadId");
        } catch { /* ignore */ }
        const focusNum = focusId ? Number(focusId) : null;
        if (focusNum && list.some((t) => t.leadId === focusNum)) {
          setSelectedLeadId(focusNum);
        } else if (!selectedLeadId && list.length > 0) {
          setSelectedLeadId(list[0].leadId);
        }
      })
      .catch((e) => {
        if (!silent) setError(e.message || "Failed to load conversations");
      })
      .finally(() => {
        if (!silent) setLoading(false);
      });
  };

  useEffect(() => {
    setSelectedLeadId(null);
    setMessages([]);
    setDraft("");
    setFilter("all");
    loadThreads(false);
  }, [channel]);

  useEffect(() => {
    const tick = () => loadThreads(true);
    const id = setInterval(tick, 20000);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
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

  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, selectedLeadId, threadLoading]);

  const waitingCount = useMemo(
    () => threads.filter((t) => t.lastMessage?.direction === "inbound").length,
    [threads]
  );

  const filteredThreads = useMemo(() => {
    const q = query.trim().toLowerCase();
    return threads.filter((t) => {
      if (filter === "waiting" && t.lastMessage?.direction !== "inbound") return false;
      if (filter === "out" && t.lastMessage?.direction !== "outbound") return false;
      if (!q) return true;
      const name = `${t.leadFirstName || ""} ${t.leadLastName || ""}`.toLowerCase();
      const contact = `${t.leadEmail || ""} ${t.leadPhone || ""}`.toLowerCase();
      const preview = (t.lastMessage?.content || "").toLowerCase();
      return name.includes(q) || contact.includes(q) || preview.includes(q);
    });
  }, [threads, query, filter]);

  const selected = threads.find((t) => t.leadId === selectedLeadId) || null;
  const selectedName = selected
    ? [selected.leadFirstName, selected.leadLastName].filter(Boolean).join(" ") || `Lead #${selected.leadId}`
    : "";

  const sendSms = async () => {
    const text = draft.trim();
    if (!isSms || !selectedLeadId || !text || sending) return;
    setSending(true);
    setError("");
    try {
      const res = await messagingApi.sendSMS(selectedLeadId, text, false);
      const stored = res.message || res;
      setMessages((prev) => [...prev, stored]);
      setDraft("");
      loadThreads(true);
      if (res.delivery && res.delivery.success === false) {
        setError(res.delivery.error || "Saved locally, but Twilio did not send.");
      }
    } catch (e) {
      setError(e.message || "Failed to send SMS");
    } finally {
      setSending(false);
    }
  };

  const draftReply = async () => {
    if (!selectedLeadId || drafting) return;
    setDrafting(true);
    setError("");
    try {
      const lastIn = [...messages].reverse().find((m) => m.direction === "inbound");
      const ctx = lastIn?.content
        ? `Lead last said: ${String(lastIn.content).slice(0, 400)}`
        : "Short SMS follow-up from the inbox.";
      const res = await aiApi.generateMessage(selectedLeadId, "sms", ctx);
      if (res?.message) setDraft(res.message);
    } catch (e) {
      setError(e.message || "Could not draft a reply");
    } finally {
      setDrafting(false);
    }
  };

  const over = draft.length > 160;

  return (
    <div className={`message-inbox ${isSms ? "is-sms" : "is-mail"}`}>
      <header className="message-inbox-hero">
        <div className="message-inbox-hero-top">
          <div>
            <div className="message-inbox-kicker">{isSms ? "Text desk" : "Mailbox"}</div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <button type="button" className="message-inbox-btn message-inbox-btn--ghost" onClick={() => loadThreads(false)}>
            Refresh
          </button>
        </div>
        <div className="message-inbox-metrics">
          <div className="message-inbox-metric">
            <span>Conversations</span>
            <strong>{threads.length}</strong>
          </div>
          <div className="message-inbox-metric">
            <span>{isSms ? "Waiting on you" : "Inbound last"}</span>
            <strong>{waitingCount}</strong>
          </div>
          <div className="message-inbox-metric">
            <span>In this thread</span>
            <strong>{selected ? messages.length : "—"}</strong>
          </div>
        </div>
      </header>

      {error && <div className="message-inbox-error">{error}</div>}

      <div className="message-inbox-shell">
        <div className="message-inbox-list">
          <div className="message-inbox-list-tools">
            <input
              placeholder={isSms ? "Search name or phone…" : "Search name, email, or subject…"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="message-inbox-filters">
              {[
                { id: "all", label: "All" },
                { id: "waiting", label: "Waiting" },
                { id: "out", label: "You sent" },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={filter === f.id ? "is-on" : ""}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="message-inbox-threads">
            {loading ? (
              <div className="message-inbox-empty">Loading conversations…</div>
            ) : filteredThreads.length === 0 ? (
              <div className="message-inbox-empty">
                {threads.length === 0
                  ? `No ${isSms ? "SMS" : "email"} yet. Threads show up when the sequence texts a lead or they reply.`
                  : "No conversations match that search."}
              </div>
            ) : (
              filteredThreads.map((t) => {
                const name = [t.leadFirstName, t.leadLastName].filter(Boolean).join(" ") || `Lead #${t.leadId}`;
                const contact = isSms ? t.leadPhone : t.leadEmail;
                const active = t.leadId === selectedLeadId;
                const waiting = t.lastMessage?.direction === "inbound";
                const preview = isSms
                  ? (t.lastMessage?.content || "").replace(/\s+/g, " ")
                  : emailPreviewLine(t.lastMessage?.content || "", 80);
                const { subject: lastSubject } = isSms
                  ? { subject: "" }
                  : parseEmailContent(t.lastMessage?.content || "");
                return (
                  <button
                    key={t.leadId}
                    type="button"
                    className={`message-inbox-thread-btn${active ? " is-active" : ""}`}
                    onClick={() => setSelectedLeadId(t.leadId)}
                  >
                    <div className={`message-inbox-avatar${waiting ? " is-wait" : ""}`}>
                      {initials(t.leadFirstName, t.leadLastName, t.leadId)}
                    </div>
                    <div>
                      <div className="message-inbox-thread-meta">
                        <strong>{name}</strong>
                        <time>{formatRelative(t.lastMessage?.createdAt)}</time>
                      </div>
                      <p>
                        {contact ? `${contact} · ` : ""}
                        {isSms
                          ? `${waiting ? "They: " : "You: "}${preview || "(empty)"}`
                          : lastSubject || preview || "(empty)"}
                        {t.messageCount > 1 ? ` · ${t.messageCount}` : ""}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="message-inbox-pane">
          {!selected ? (
            <div className="message-inbox-empty" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              Select a conversation
            </div>
          ) : (
            <>
              <div className="message-inbox-pane-head">
                <div>
                  <h2>{selectedName}</h2>
                  <p>
                    {isSms ? selected.leadPhone : selected.leadEmail}
                    {" · "}
                    {isSms ? "SMS" : "Email"}
                  </p>
                </div>
                <div className="message-inbox-pane-actions">
                  <span style={S.badge(isSms ? COLORS.teal : COLORS.blue)}>
                    {messages.length} {isSms ? "text" : "email"}{messages.length === 1 ? "" : "s"}
                  </span>
                  <button
                    type="button"
                    className="message-inbox-btn message-inbox-btn--ghost"
                    onClick={() => navigate(`/leads/${selected.leadId}`)}
                  >
                    Open lead
                  </button>
                </div>
              </div>

              <div className="message-inbox-stream">
                {threadLoading ? (
                  <div className="message-inbox-empty">Loading messages…</div>
                ) : messages.length === 0 ? (
                  <div className="message-inbox-empty">No messages in this thread.</div>
                ) : isSms ? (
                  messages.map((m) => <SmsBubble key={m.id} message={m} leadName={selectedName} />)
                ) : (
                  messages.map((m) => (
                    <EmailCard
                      key={m.id}
                      message={m}
                      leadName={selectedName}
                      leadEmail={selected.leadEmail}
                    />
                  ))
                )}
                <div ref={streamEndRef} />
              </div>

              {isSms && (
                <div className="message-inbox-composer">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={`Reply to ${selectedName.split(" ")[0] || "lead"}…`}
                    aria-label="SMS reply"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendSms();
                    }}
                  />
                  <div className="message-inbox-composer-bar">
                    <em className={over ? "is-over" : ""}>
                      {draft.length}/160{over ? " · will split on some carriers" : " · ⌘ Enter to send"}
                    </em>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        className="message-inbox-btn message-inbox-btn--ghost"
                        disabled={drafting}
                        onClick={draftReply}
                      >
                        {drafting ? "Drafting…" : "Draft reply"}
                      </button>
                      <button
                        type="button"
                        className="message-inbox-btn message-inbox-btn--primary"
                        disabled={sending || !draft.trim()}
                        onClick={sendSms}
                      >
                        {sending ? "Sending…" : "Send SMS"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SmsBubble({ message: m, leadName }) {
  const inbound = m.direction === "inbound";
  return (
    <div className={`message-inbox-bubble-row ${inbound ? "is-in" : "is-out"}`}>
      <div className={`message-inbox-bubble ${inbound ? "is-in" : "is-out"}`}>
        <small>
          {inbound ? leadName : m.aiGenerated ? "SDR AI" : "You"}
          {" · "}
          {m.createdAt ? new Date(m.createdAt).toLocaleString() : ""}
          {m.status && m.status !== "sent" ? ` · ${m.status}` : ""}
        </small>
        {m.content}
      </div>
    </div>
  );
}

function EmailCard({ message: m, leadName, leadEmail }) {
  const inbound = m.direction === "inbound";
  const { subject, body } = parseEmailContent(m.content);
  const fromLabel = inbound
    ? `${leadName || "Lead"}${leadEmail ? ` <${leadEmail}>` : ""}`
    : m.aiGenerated
      ? "SDR AI (Levios)"
      : "You";
  const toLabel = inbound ? "SDR AI (Levios)" : (leadEmail || leadName || "Lead");

  return (
    <article
      style={{
        marginBottom: 18,
        borderRadius: 10,
        border: `1px solid ${COLORS.border}`,
        background: COLORS.surface,
        overflow: "hidden",
      }}
    >
      <header
        style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${COLORS.border}`,
          background: COLORS.surfaceAlt,
        }}
      >
        <span style={S.badge(inbound ? COLORS.blue : COLORS.purple)}>
          {inbound ? "Inbound" : m.aiGenerated ? "Outbound · AI" : "Outbound"}
        </span>
        <span style={{ fontSize: 11, color: COLORS.textMuted, marginLeft: 8 }}>
          {m.createdAt ? new Date(m.createdAt).toLocaleString() : ""}
        </span>
      </header>
      <div style={{ padding: "14px 16px 8px" }}>
        <MetaRow label="From" value={fromLabel} />
        <MetaRow label="To" value={toLabel} />
        <div style={{ fontSize: 15, fontWeight: 700, marginTop: 8 }}>{subject || "(no subject)"}</div>
      </div>
      <div style={{ padding: "8px 16px 20px", fontSize: 14, lineHeight: 1.65, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {body || <span style={{ color: COLORS.textMuted }}>(empty body)</span>}
      </div>
    </article>
  );
}

function MetaRow({ label, value }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "56px 1fr", gap: 8, marginBottom: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 650, color: COLORS.textMuted, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 13 }}>{value}</div>
    </div>
  );
}
