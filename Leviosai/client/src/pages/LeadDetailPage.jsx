import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { COLORS, S } from "../theme.js";
import { leadsApi, messagingApi } from "../api.js";
import { LeadSequencesPanel } from "../components/sdr/LeadSequencesPanel.jsx";
import { parseEmailContent } from "../lib/emailMessage.js";

const NAV = [
  { id: "overview", label: "Overview", icon: "👤" },
  { id: "sequences", label: "Sequences", icon: "🔁" },
  { id: "messages", label: "Messages", icon: "💬" },
  { id: "score", label: "Score", icon: "📈" },
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

  const tab = searchParams.get("tab") || "overview";

  const setTab = (id) => {
    setSearchParams(id === "overview" ? {} : { tab: id }, { replace: true });
  };

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
      {/* Lead-local sidebar */}
      <aside className={`lead-rail ${railCollapsed ? "is-collapsed" : ""}`}>
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
          <button
            type="button"
            className="lead-rail-toggle"
            onClick={() => setRailCollapsed((v) => !v)}
            title={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={railCollapsed ? "Expand lead sidebar" : "Collapse lead sidebar"}
          >
            {railCollapsed ? "»" : "«"}
          </button>
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

      {/* Main panel */}
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
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
                <InfoCard label="Phone" value={lead.phone || "—"} />
                <InfoCard label="Email" value={lead.email || "—"} />
                <InfoCard label="Source" value={lead.source || "—"} />
                <InfoCard label="Score" value={`${lead.score}/100`} accent={lead.score > 75 ? COLORS.green : COLORS.orange} />
                <InfoCard label="SMS messages" value={String(smsCount)} />
                <InfoCard label="Emails" value={String(emailCount)} />
              </div>
              {lead.notes && (
                <div style={S.card}>
                  <div style={S.cardHeader}>Notes</div>
                  <div style={{ fontSize: 13, lineHeight: 1.6, color: COLORS.textMuted }}>{lead.notes}</div>
                </div>
              )}
              <div style={{ ...S.card, marginBottom: 0 }}>
                <div style={S.cardHeader}>Quick actions</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button type="button" style={S.btn("ghost")} onClick={() => setTab("sequences")}>Open sequences →</button>
                  <button type="button" style={S.btn("ghost")} onClick={() => setTab("messages")}>View messages →</button>
                  <button type="button" style={S.btn("ghost")} onClick={() => setTab("score")}>Score analysis →</button>
                </div>
              </div>
            </div>
          )}

          {tab === "sequences" && (
            <LeadSequencesPanel lead={lead} onNavigate={onNavigate} />
          )}

          {tab === "messages" && (
            <MessagesTab
              messages={messages}
              onOpenSms={() => openInbox("sms")}
              onOpenEmail={() => openInbox("email")}
            />
          )}

          {tab === "score" && (
            <div style={S.card}>
              <div style={S.cardHeader}>Lead score</div>
              <div style={{ fontSize: 42, fontWeight: 800, color: lead.score > 75 ? COLORS.green : lead.score > 50 ? COLORS.yellow : COLORS.red }}>
                {lead.score}
                <span style={{ fontSize: 16, color: COLORS.textMuted, fontWeight: 500 }}> / 100</span>
              </div>
              <p style={{ fontSize: 13, color: COLORS.textMuted, lineHeight: 1.55, marginTop: 12, maxWidth: 520 }}>
                {lead.score > 75
                  ? "High intent. Prioritize a live call and booking offer within 48 hours."
                  : lead.score > 50
                    ? "Moderate interest. Keep the multi-touch sequence moving — SMS, email, then voice."
                    : "Low engagement. Soft re-entry via value-first email/SMS before another dial."}
              </p>
            </div>
          )}
        </div>
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

function MessagesTab({ messages, onOpenSms, onOpenEmail }) {
  if (!messages?.length) {
    return (
      <div style={{ textAlign: "center", color: COLORS.textMuted, padding: 48, fontSize: 13 }}>
        No messages yet.
        <div style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "center" }}>
          <button type="button" style={S.btn("secondary")} onClick={onOpenSms}>Open SMS Inbox</button>
          <button type="button" style={S.btn("secondary")} onClick={onOpenEmail}>Open Email Inbox</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button type="button" style={S.btn("secondary")} onClick={onOpenSms}>Open SMS Inbox →</button>
        <button type="button" style={S.btn("secondary")} onClick={onOpenEmail}>Open Email Inbox →</button>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {[...messages].reverse().map((m) => {
          const isEmail = m.channel === "email";
          const parsed = isEmail ? parseEmailContent(m.content) : null;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => (isEmail ? onOpenEmail() : onOpenSms())}
              style={{
                textAlign: "left",
                padding: "12px 14px",
                borderRadius: 10,
                border: `1px solid ${COLORS.border}`,
                background: COLORS.surface,
                color: "inherit",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                <span style={S.badge(isEmail ? COLORS.purple : COLORS.orange)}>
                  {isEmail ? "Email" : "SMS"} · {m.direction}
                </span>
                <span style={{ fontSize: 11, color: COLORS.textMuted }}>
                  {m.createdAt ? new Date(m.createdAt).toLocaleString() : ""}
                </span>
              </div>
              {isEmail ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{parsed.subject || "(no subject)"}</div>
                  <div style={{ fontSize: 12, color: COLORS.textMuted, lineHeight: 1.45 }}>
                    {(parsed.body || "").replace(/\s+/g, " ").slice(0, 140)}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 13, lineHeight: 1.45 }}>{(m.content || "").slice(0, 160)}</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
