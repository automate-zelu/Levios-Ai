import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { COLORS, S } from "../theme.js";
import { leadsApi, messagingApi } from "../api.js";
import { LeadSequencesPanel } from "../components/sdr/LeadSequencesPanel.jsx";
import { parseEmailContent } from "../lib/emailMessage.js";

const NAV = [
  { id: "overview", label: "Overview", icon: "👤" },
  { id: "sequences", label: "Sequences", icon: "🔁" },
];

const STATUS_LABEL = {
  new: "New",
  lost: "Dead",
  contacted: "Aged",
  qualified: "Revived",
  proposal: "Appointment Set",
  won: "Revived",
};

const STATUS_COLOR = {
  Dead: COLORS.red,
  Aged: COLORS.yellow,
  Revived: COLORS.blue,
  New: COLORS.green,
  "Appointment Set": COLORS.purple,
};

/**
 * Full-page lead workspace with its own sidebar navigation.
 * Main CRM sidebar collapses while this page is open.
 */
export default function LeadDetailPage({ onNavigate }) {
  const { leadId: paramLeadId } = useParams();
  const location = useLocation();
  const leadId = paramLeadId || location.pathname.match(/^\/leads\/([^/]+)/)?.[1];
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [lead, setLead] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [busy, setBusy] = useState("");
  const [chatOpen, setChatOpen] = useState(false);

  const rawTab = searchParams.get("tab") || "overview";
  const tab = rawTab === "sequences" ? "sequences" : "overview";

  const setTab = (id) => {
    setSearchParams(id === "overview" ? {} : { tab: id }, { replace: true });
  };

  // Legacy ?tab=messages|score → overview
  useEffect(() => {
    if (rawTab === "messages" || rawTab === "score") {
      setSearchParams({}, { replace: true });
    }
  }, [rawTab, setSearchParams]);

  const load = () => {
    const id = Number(leadId);
    if (!id) {
      setError("Invalid lead");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    Promise.all([leadsApi.get(id), leadsApi.getMessages(id).catch(() => [])])
      .then(([l, msgs]) => {
        setLead({
          ...l,
          name: `${l.firstName || ""} ${l.lastName || ""}`.trim() || `Lead #${l.id}`,
          statusLabel: STATUS_LABEL[l.status] || l.status,
          score: l.aiScore || 0,
        });
        setMessages(msgs || []);
      })
      .catch((e) => setError(e.message || "Failed to load lead"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [leadId]);

  const sortedMessages = useMemo(
    () =>
      [...(messages || [])].sort(
        (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
      ),
    [messages]
  );

  const smsCount = useMemo(() => messages.filter((m) => m.channel === "sms").length, [messages]);
  const emailCount = useMemo(() => messages.filter((m) => m.channel === "email").length, [messages]);

  const openInbox = (channel) => {
    try {
      sessionStorage.setItem("inboxFocusLeadId", String(leadId));
    } catch { /* ignore */ }
    onNavigate?.(channel === "sms" ? "SMS Inbox" : "Email Inbox");
  };

  const startCall = async () => {
    setBusy("call");
    try {
      await messagingApi.initiateCall(lead.id);
    } catch (e) {
      setError(e.message || "Call failed");
    } finally {
      setBusy("");
    }
  };

  if (loading) {
    return (
      <div className="lead-detail-shell">
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.textMuted }}>
          Loading lead…
        </div>
      </div>
    );
  }

  if (error && !lead) {
    return (
      <div className="lead-detail-shell" style={{ padding: 28 }}>
        <button type="button" style={S.btn("ghost")} onClick={() => navigate("/leads")}>← Back to Leads</button>
        <div style={{ marginTop: 20, color: COLORS.red }}>{error}</div>
      </div>
    );
  }

  return (
    <div className="lead-detail-shell">
      <aside className={`lead-rail ${railCollapsed ? "is-collapsed" : ""}`}>
        <button
          type="button"
          className="lead-rail-edge-toggle"
          onClick={() => setRailCollapsed((v) => !v)}
          title={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={railCollapsed ? "Expand lead sidebar" : "Collapse lead sidebar"}
        >
          {railCollapsed ? "›" : "‹"}
        </button>

        <div className="lead-rail-head">
          <button
            type="button"
            className="lead-rail-back"
            onClick={() => navigate("/leads")}
            title="Back to leads"
          >
            ←
          </button>
          <div className="lead-rail-title-wrap">
            <div className="lead-rail-kicker">Lead</div>
            <div className="lead-rail-name">{lead.name}</div>
          </div>
        </div>

        <nav className="lead-rail-nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`lead-rail-item ${tab === item.id ? "active" : ""}`}
              onClick={() => setTab(item.id)}
              title={item.label}
            >
              <span className="lead-rail-icon">{item.icon}</span>
              <span className="lead-rail-label">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="lead-rail-foot">
          <button type="button" className="lead-rail-item" onClick={() => openInbox("sms")} title="SMS Inbox">
            <span className="lead-rail-icon">💬</span>
            <span className="lead-rail-label">SMS Inbox</span>
          </button>
          <button type="button" className="lead-rail-item" onClick={() => openInbox("email")} title="Email Inbox">
            <span className="lead-rail-icon">✉️</span>
            <span className="lead-rail-label">Email Inbox</span>
          </button>
        </div>
      </aside>

      <div className="lead-detail-main">
        <header className="lead-detail-top">
          <div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
              <h1 style={{ fontSize: 22, fontWeight: 750, margin: 0 }}>{lead.name}</h1>
              <span style={S.badge(STATUS_COLOR[lead.statusLabel] || COLORS.textMuted)}>{lead.statusLabel}</span>
            </div>
            <div style={{ fontSize: 13, color: COLORS.textMuted }}>
              {[lead.phone, lead.email, lead.source].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={S.btn("primary")} disabled={busy === "call"} onClick={startCall}>
              {busy === "call" ? "Calling…" : "📞 Call"}
            </button>
            <button type="button" style={S.btn("secondary")} onClick={() => openInbox("sms")}>💬 SMS</button>
            <button type="button" style={S.btn("secondary")} onClick={() => openInbox("email")}>✉️ Email</button>
          </div>
        </header>

        {error && (
          <div style={{ margin: "0 24px 12px", padding: "10px 14px", borderRadius: 8, background: `${COLORS.red}18`, color: COLORS.red, fontSize: 13 }}>
            {error}
          </div>
        )}

        <div className="lead-detail-body">
          {tab === "overview" && (
            <OverviewPanel
              lead={lead}
              messages={sortedMessages}
              smsCount={smsCount}
              emailCount={emailCount}
              onOpenChat={() => setChatOpen(true)}
              onOpenSequences={() => setTab("sequences")}
            />
          )}

          {tab === "sequences" && (
            <LeadSequencesPanel lead={lead} onNavigate={onNavigate} />
          )}
        </div>
      </div>

      {chatOpen && (
        <ConversationModal
          leadName={lead.name}
          messages={sortedMessages}
          onClose={() => setChatOpen(false)}
          onOpenInbox={openInbox}
        />
      )}
    </div>
  );
}

function OverviewPanel({ lead, messages, smsCount, emailCount, onOpenChat, onOpenSequences }) {
  const preview = messages.slice(-4);
  const scoreHint =
    lead.score > 75
      ? "High intent — prioritize a live call within 48 hours."
      : lead.score > 50
        ? "Moderate interest — keep the multi-touch sequence moving."
        : "Low engagement — soft re-entry via value-first SMS/email.";

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
        <InfoCard label="Phone" value={lead.phone || "—"} />
        <InfoCard label="Email" value={lead.email || "—"} />
        <InfoCard label="Source" value={lead.source || "—"} />
        <InfoCard label="Score" value={`${lead.score}/100`} accent={lead.score > 75 ? COLORS.green : lead.score > 50 ? COLORS.yellow : COLORS.red} />
        <InfoCard label="SMS" value={String(smsCount)} />
        <InfoCard label="Emails" value={String(emailCount)} />
      </div>

      <div style={{ ...S.card, marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: COLORS.textMuted, lineHeight: 1.55 }}>{scoreHint}</div>
      </div>

      {lead.notes && (
        <div style={S.card}>
          <div style={S.cardHeader}>Notes</div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: COLORS.textMuted }}>{lead.notes}</div>
        </div>
      )}

      <div style={{ ...S.card, marginBottom: 16 }}>
        <div style={{ ...S.cardHeader, marginBottom: 12 }}>
          <span>Conversation</span>
          <button type="button" style={{ ...S.btn("secondary"), padding: "8px 14px", fontSize: 12 }} onClick={onOpenChat}>
            Open chat
          </button>
        </div>

        {messages.length === 0 ? (
          <div style={{ padding: "28px 12px", textAlign: "center", color: COLORS.textMuted, fontSize: 13 }}>
            No messages yet. Start a call, SMS, or email to begin the thread.
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpenChat}
            style={{
              width: "100%",
              textAlign: "left",
              border: `1px solid ${COLORS.border}`,
              borderRadius: 12,
              background: COLORS.bg,
              padding: "16px 18px",
              cursor: "pointer",
              fontFamily: "inherit",
              color: "inherit",
            }}
          >
            <div style={{ display: "grid", gap: 10 }}>
              {preview.map((m) => {
                const inbound = m.direction === "inbound";
                const isEmail = m.channel === "email";
                const parsed = isEmail ? parseEmailContent(m.content) : null;
                const text = isEmail
                  ? `${parsed.subject || "(no subject)"} — ${(parsed.body || "").replace(/\s+/g, " ").slice(0, 80)}`
                  : (m.content || "").slice(0, 100);
                return (
                  <div
                    key={m.id}
                    style={{
                      display: "flex",
                      justifyContent: inbound ? "flex-start" : "flex-end",
                    }}
                  >
                    <div
                      style={{
                        maxWidth: "78%",
                        padding: "10px 12px",
                        borderRadius: 12,
                        background: inbound ? COLORS.surfaceAlt : `${COLORS.orange}18`,
                        border: `1px solid ${inbound ? COLORS.border : `${COLORS.orange}40`}`,
                      }}
                    >
                      <div style={{ fontSize: 10, color: COLORS.textMuted, marginBottom: 4 }}>
                        {isEmail ? "Email" : "SMS"} · {inbound ? "Lead" : "You"}
                      </div>
                      <div style={{ fontSize: 13, lineHeight: 1.4, color: COLORS.text }}>{text}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 14, fontSize: 12, color: COLORS.orangeLight, fontWeight: 600 }}>
              View full conversation →
            </div>
          </button>
        )}
      </div>

      <div style={{ ...S.card, marginBottom: 0 }}>
        <div style={S.cardHeader}>Next</div>
        <button type="button" style={S.btn("ghost")} onClick={onOpenSequences}>
          Open sequences →
        </button>
      </div>
    </div>
  );
}

function ConversationModal({ leadName, messages, onClose, onOpenInbox }) {
  const scrollerRef = useRef(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Conversation with ${leadName}`}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1200,
        backdropFilter: "blur(4px)",
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(720px, 100%)",
          height: "min(780px, 88vh)",
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 18,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
        }}
      >
        <div
          style={{
            padding: "20px 24px",
            borderBottom: `1px solid ${COLORS.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
              Conversation
            </div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{leadName}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={{ ...S.btn("ghost"), padding: "8px 12px", fontSize: 12 }} onClick={() => onOpenInbox("sms")}>
              SMS Inbox
            </button>
            <button type="button" style={{ ...S.btn("ghost"), padding: "8px 12px", fontSize: 12 }} onClick={() => onOpenInbox("email")}>
              Email Inbox
            </button>
            <button type="button" style={{ ...S.btn("ghost"), padding: "8px 12px" }} onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </div>

        <div
          ref={scrollerRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px 28px",
            background: COLORS.bg,
            WebkitOverflowScrolling: "touch",
          }}
        >
          {messages.length === 0 ? (
            <div style={{ textAlign: "center", color: COLORS.textMuted, padding: 48, fontSize: 13 }}>
              No messages in this thread yet.
            </div>
          ) : (
            messages.map((m) => <ChatBubble key={m.id} msg={m} />)
          )}
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ msg }) {
  const inbound = msg.direction === "inbound";
  const isEmail = msg.channel === "email";
  const parsed = isEmail ? parseEmailContent(msg.content) : null;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: inbound ? "flex-start" : "flex-end",
        marginBottom: 14,
      }}
    >
      <div
        style={{
          maxWidth: "78%",
          padding: "14px 16px",
          borderRadius: 16,
          background: inbound ? COLORS.surfaceAlt : `${COLORS.orange}18`,
          border: `1px solid ${inbound ? COLORS.border : `${COLORS.orange}44`}`,
        }}
      >
        <div style={{ fontSize: 10, color: COLORS.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4 }}>
          {isEmail ? "Email" : "SMS"} · {inbound ? "Lead" : msg.aiGenerated ? "AI" : "You"}
          {" · "}
          {msg.createdAt ? new Date(msg.createdAt).toLocaleString() : ""}
        </div>
        {isEmail ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, lineHeight: 1.35 }}>
              {parsed.subject || "(no subject)"}
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
              {parsed.body || "(empty)"}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{msg.content}</div>
        )}
      </div>
    </div>
  );
}

function InfoCard({ label, value, accent }) {
  return (
    <div style={{ padding: "14px 16px", borderRadius: 10, background: COLORS.surface, border: `1px solid ${COLORS.border}` }}>
      <div style={{ fontSize: 10, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.45, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 650, color: accent || COLORS.text, wordBreak: "break-word" }}>{value}</div>
    </div>
  );
}
