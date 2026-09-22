import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { COLORS, S } from "../theme.js";
import { gmailApi, calendarApi } from "../api.js";
import CalendarConnections from "../components/calendar/CalendarConnections.jsx";
import TwilioByotCard from "../components/sdr/TwilioByotCard.jsx";
import TelnyxByotCard from "../components/sdr/TelnyxByotCard.jsx";
import GmailConnectCard from "../components/sdr/GmailConnectCard.jsx";
import { CalendarToolsPanel } from "../components/sdr/CalendarToolsPanel.jsx";
import AgentStack from "../components/sdr/AgentStack.jsx";
import "./sdr-setup.css";

const PIPELINE_STEPS = [
  {
    id: "gates",
    title: "Billing + activation gates",
    body: "Subscribe on Billing, then activate SDR Agent. No AI calls fire until the workspace is paid and the SDR config is active.",
  },
  {
    id: "trigger",
    title: "1. Trigger — dormant lead or manual enroll",
    body: "The Reactor scans CRM leads past your dormant-days threshold and creates an enrollment, or you enroll a lead manually. Each enrollment counts toward monthly lead usage.",
  },
  {
    id: "call",
    title: "2. AI phone call (Twilio + Deepgram + LangChain + ElevenLabs)",
    body: "The sequence places an outbound call using your connected Twilio or Telnyx number and Voice AI selection. Live audio: speech→text (Deepgram) → single system prompt agent (LangChain) → voice (ElevenLabs). Objection handling lives inside that one prompt — not a separate module.",
  },
  {
    id: "branch",
    title: "3. Call outcome branches",
    body: "Answered / booked → sequence can complete and CRM is updated. No-answer / voicemail → wait, then SMS. Busy → short retries, then SMS. Failed → logged and fall-through per rules.",
  },
  {
    id: "sms",
    title: "4. SMS follow-up",
    body: "After wait-after-call hours, your connected phone provider sends your SMS template ({{first_name}}). Reply → sequence stops as engaged. No reply → wait-after-SMS hours, then email.",
  },
  {
    id: "email",
    title: "5. Email follow-up",
    body: "Your email subject/body are sent from the Gmail account you connected on SDR Setup (same BYOT model as Twilio for SMS). Reply → engaged. Timeout → enrollment marked exhausted; re-enrollment waits re-enroll days.",
  },
  {
    id: "crm",
    title: "6. CRM + calling panel",
    body: "Every step is written to SDR logs. Call recordings and transcripts appear under AI Calling. Booked outcomes update the CRM.",
  },
];

const FLOW_CHIPS = [
  "Dormant / enroll",
  "AI Call",
  "SMS",
  "Email",
  "Booked or Exhausted",
];

function SetupSection({ id, tone, title, subtitle, children, split = false, bare = false }) {
  return (
    <section className="sdr-setup-workbench" id={id}>
      <div className="sdr-setup-workbench-head">
        <div>
          <div className={`sdr-setup-tone sdr-setup-tone--${tone}`}>{tone}</div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      {bare ? children : <div className={`sdr-setup-panel${split ? " sdr-setup-split" : ""}`}>{children}</div>}
    </section>
  );
}

function StatusPill({ ok }) {
  return (
    <span className={`sdr-setup-pill ${ok ? "sdr-setup-pill--on" : "sdr-setup-pill--off"}`}>
      {ok ? "Live" : "Off"}
    </span>
  );
}

function HowSdrWorksModal({ open, onClose, onNavigate }) {
  if (!open) return null;

  const go = (path) => {
    onClose();
    onNavigate(path);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="how-sdr-works-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.65)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 640,
          maxHeight: "min(90vh, 820px)",
          overflow: "auto",
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 14,
          padding: 24,
          boxShadow: "0 20px 50px rgba(0,0,0,0.45)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
          <div>
            <div id="how-sdr-works-title" style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
              How the AI SDR works
            </div>
            <p style={{ fontSize: 13, color: COLORS.textMuted, lineHeight: 1.55, margin: 0 }}>
              Locked pipeline: one engine for every workspace. You configure content (prompt, voice, templates) — not the sequence order.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: COLORS.textMuted,
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              padding: 4,
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
            margin: "18px 0",
          }}
        >
          {FLOW_CHIPS.map((label, i) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  display: "inline-block",
                  padding: "6px 12px",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 600,
                  background: COLORS.surfaceAlt,
                  border: `1px solid ${COLORS.border}`,
                  color: COLORS.text,
                }}
              >
                {label}
              </span>
              {i < FLOW_CHIPS.length - 1 && (
                <span style={{ color: COLORS.textDim, fontSize: 14 }}>→</span>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gap: 12, marginBottom: 18 }}>
          {PIPELINE_STEPS.map((step, idx) => (
            <div
              key={step.id}
              style={{
                padding: 14,
                borderRadius: 10,
                border: `1px solid ${COLORS.border}`,
                background: idx === 0 ? `${COLORS.orange}08` : COLORS.surfaceAlt,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: idx === 0 ? COLORS.orangeLight : COLORS.text }}>
                {step.title}
              </div>
              <div style={{ fontSize: 12, color: COLORS.textMuted, lineHeight: 1.55 }}>{step.body}</div>
            </div>
          ))}
        </div>

        <div
          style={{
            padding: 14,
            borderRadius: 10,
            border: `1px dashed ${COLORS.border}`,
            background: "transparent",
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 8 }}>Where to configure each piece</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: COLORS.textMuted, lineHeight: 1.7 }}>
            <li>
              <strong style={{ color: COLORS.text }}>This page (SDR Setup)</strong> — Twilio, Gmail, Google Calendar, and booking window
            </li>
            <li>
              <strong style={{ color: COLORS.text }}>SDR Agent</strong> — single system prompt (incl. objections), knowledge base, SMS/email templates, thresholds, activate
            </li>
            <li>
              <strong style={{ color: COLORS.text }}>Voice AI</strong> — ElevenLabs voice for live calls only
            </li>
            <li>
              <strong style={{ color: COLORS.text }}>AI Calling</strong> — call log, recordings, transcripts
            </li>
            <li>
              <strong style={{ color: COLORS.text }}>SMS Inbox / Email Inbox</strong> — full text & email conversation threads with leads
            </li>
            <li>
              <strong style={{ color: COLORS.text }}>Billing</strong> — subscription required before SDR can go live
            </li>
          </ul>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" style={{ ...S.btn("ghost"), padding: "8px 14px", fontSize: 12 }} onClick={onClose}>
            Close
          </button>
          <button type="button" style={{ ...S.btn("ghost"), padding: "8px 14px", fontSize: 12 }} onClick={() => go("/billing")}>
            Open Billing
          </button>
          <button type="button" style={{ ...S.btn("ghost"), padding: "8px 14px", fontSize: 12 }} onClick={() => go("/calling")}>
            View call logs
          </button>
          <button type="button" style={{ ...S.btn("primary"), padding: "8px 14px", fontSize: 12 }} onClick={() => go("/sdr")}>
            Configure SDR Agent
          </button>
        </div>
      </div>
    </div>
  );
}

function PhoneSetupModal({ open, onClose, onChanged }) {
  const [tab, setTab] = useState("twilio");
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="phone-setup-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.65)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 720,
          maxHeight: "min(90vh, 900px)",
          overflow: "auto",
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 14,
          padding: 24,
          boxShadow: "0 20px 50px rgba(0,0,0,0.45)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
          <div>
            <div id="phone-setup-title" style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
              Phone & SMS
            </div>
            <p style={{ fontSize: 13, color: COLORS.textMuted, lineHeight: 1.55, margin: 0 }}>
              Connect Twilio or Telnyx (or both). Only one is active for outbound calls and SMS — pick which
              provider to use after assigning a number.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: COLORS.textMuted,
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              padding: 4,
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            display: "flex",
            gap: 0,
            marginBottom: 16,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          {[
            ["twilio", "Twilio"],
            ["telnyx", "Telnyx"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              style={{
                flex: 1,
                padding: "10px 0",
                fontSize: 12,
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                background: tab === key ? COLORS.orange : "transparent",
                color: tab === key ? "#fff" : COLORS.textMuted,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "twilio" ? (
          <TwilioByotCard onChanged={onChanged} />
        ) : (
          <TelnyxByotCard onChanged={onChanged} />
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" style={{ ...S.btn("ghost"), padding: "8px 14px", fontSize: 12 }} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * SDR Setup — channels (Twilio/Telnyx, Gmail, Calendar) + booking rules + links to agent content.
 */
export default function SDRSetupPage() {
  const navigate = useNavigate();
  const [howOpen, setHowOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phoneStatus, setPhoneStatus] = useState(null);
  const [gmailStatus, setGmailStatus] = useState(null);
  const [calendarStatus, setCalendarStatus] = useState(null);
  const [statusTick, setStatusTick] = useState(0);

  const refreshPhoneStatus = () => {
    const token = localStorage.getItem("catalyst_token");
    if (!token) return;
    Promise.all([
      fetch("/api/twilio/status", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
      fetch("/api/telnyx/status", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
    ])
      .then(([twilio, telnyx]) => {
        const twilioReady = !!(twilio?.connected && twilio?.phoneNumber);
        const telnyxReady = !!(telnyx?.connected && telnyx?.phoneNumber);
        const active =
          telnyx?.active && telnyxReady
            ? "telnyx"
            : twilio?.active && twilioReady
              ? "twilio"
              : telnyxReady
                ? "telnyx"
                : twilioReady
                  ? "twilio"
                  : null;
        const phoneNumber =
          active === "telnyx" ? telnyx.phoneNumber : active === "twilio" ? twilio.phoneNumber : null;
        setPhoneStatus({
          connected: twilioReady || telnyxReady,
          active,
          phoneNumber,
          twilio,
          telnyx,
        });
      })
      .catch(() => {});
  };

  useEffect(() => {
    const token = localStorage.getItem("catalyst_token");
    if (!token) return;
    refreshPhoneStatus();
    gmailApi.status().then(setGmailStatus).catch(() => {});
    calendarApi.status().then(setCalendarStatus).catch(() => {});
  }, [phoneOpen, statusTick]);

  useEffect(() => {
    const id = window.location.hash.replace("#", "");
    if (!id) return;
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const calendarConn = calendarStatus?.connections?.find((c) => c.provider === calendarStatus?.activeProvider);
  const calendarOk = !!calendarStatus?.activeProvider;
  const phoneOk = !!phoneStatus?.connected;
  const mailOk = !!gmailStatus?.connected;
  const readyCount = [phoneOk, mailOk, calendarOk].filter(Boolean).length;

  const phoneLabel = (() => {
    if (!phoneOk) return "Connect Twilio or Telnyx and assign a number";
    const provider = phoneStatus.active === "telnyx" ? "Telnyx" : "Twilio";
    return phoneStatus.phoneNumber
      ? `${provider} · ${phoneStatus.phoneNumber}`
      : `${provider} connected`;
  })();

  return (
    <div className="sdr-setup">
      <header className="sdr-setup-hero">
        <div className="sdr-setup-hero-top">
          <div>
            <div className="sdr-setup-kicker">Outbound desk</div>
            <h1>SDR Setup</h1>
            <p>
              Wire the three channels the agent uses on a live sequence. Prompt and voice stay on SDR Agent.
            </p>
          </div>
          <button type="button" className="sdr-setup-how" onClick={() => setHowOpen(true)}>
            How the pipeline works
          </button>
        </div>
        <div className="sdr-setup-ready">
          <strong>{readyCount}/3</strong>
          <span>channels connected — phone, email, and calendar</span>
        </div>
      </header>

      <AgentStack />

      <HowSdrWorksModal open={howOpen} onClose={() => setHowOpen(false)} onNavigate={navigate} />
      <PhoneSetupModal
        open={phoneOpen}
        onClose={() => setPhoneOpen(false)}
        onChanged={() => setStatusTick((n) => n + 1)}
      />

      <div className="sdr-setup-board" aria-label="Channel status">
        <button type="button" className="sdr-setup-channel sdr-setup-channel--phone" onClick={() => setPhoneOpen(true)}>
          <div className="sdr-setup-channel-kind">Phone</div>
          <div className="sdr-setup-channel-copy">
            <strong>Calls & SMS</strong>
            <p>{phoneLabel}</p>
          </div>
          <StatusPill ok={phoneOk} />
        </button>

        <a href="#setup-email" className="sdr-setup-channel sdr-setup-channel--mail">
          <div className="sdr-setup-channel-kind">Mail</div>
          <div className="sdr-setup-channel-copy">
            <strong>Follow-up email</strong>
            <p>
              {mailOk
                ? gmailStatus.accountEmail || "Gmail connected"
                : "Send from your Gmail, not a shared mailbox"}
            </p>
          </div>
          <StatusPill ok={mailOk} />
        </a>

        <a href="#setup-calendar" className="sdr-setup-channel sdr-setup-channel--cal">
          <div className="sdr-setup-channel-kind">Cal</div>
          <div className="sdr-setup-channel-copy">
            <strong>Bookings</strong>
            <p>
              {calendarOk
                ? calendarConn?.accountEmail || "Google Calendar connected"
                : "Connect Google Calendar for live availability"}
            </p>
          </div>
          <StatusPill ok={calendarOk} />
        </a>
      </div>

      <SetupSection
        id="setup-email"
        tone="mail"
        title="Gmail"
        subtitle="Sequence emails go out from this account after the call and SMS steps."
      >
        <GmailConnectCard />
      </SetupSection>

      <SetupSection
        id="setup-calendar"
        tone="cal"
        title="Calendar & booking window"
        subtitle="Connect Google, pick the calendar, then set what the agent is allowed to offer on a call."
        split
      >
        <div>
          <CalendarConnections colors={COLORS} styles={S} />
        </div>
        <div>
          <CalendarToolsPanel persistPrompt embedded />
        </div>
      </SetupSection>

      <SetupSection
        tone="agent"
        title="Agent content"
        subtitle="These stay separate from the wiring on this page."
        bare
      >
        <div className="sdr-setup-dest">
          <button type="button" onClick={() => navigate("/sdr")}>
            <small>Prompt</small>
            <strong>SDR Agent</strong>
            <span>System prompt, OpenAI Realtime voice, knowledge, timing.</span>
          </button>
          <button type="button" onClick={() => navigate("/calling")}>
            <small>Activity</small>
            <strong>AI Calling</strong>
            <span>Sessions, recordings, and transcripts.</span>
          </button>
        </div>
      </SetupSection>
    </div>
  );
}
