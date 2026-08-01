import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { COLORS, S } from "../theme.js";
import CalendarConnections from "../components/calendar/CalendarConnections.jsx";
import TwilioByotCard from "../components/sdr/TwilioByotCard.jsx";
import GmailConnectCard from "../components/sdr/GmailConnectCard.jsx";

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
    body: "The sequence places an outbound call using your Twilio number and Voice AI selection. Live audio: speech→text (Deepgram) → single system prompt agent (LangChain) → voice (ElevenLabs). Objection handling lives inside that one prompt — not a separate module.",
  },
  {
    id: "branch",
    title: "3. Call outcome branches",
    body: "Answered / booked → sequence can complete and CRM is updated. No-answer / voicemail → wait, then SMS. Busy → short retries, then SMS. Failed → logged and fall-through per rules.",
  },
  {
    id: "sms",
    title: "4. SMS follow-up",
    body: "After wait-after-call hours, Twilio sends your SMS template ({{first_name}}). Reply → sequence stops as engaged. No reply → wait-after-SMS hours, then email.",
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

function SetupSection({ step, title, subtitle, children }) {
  return (
    <section style={{ ...S.card, marginBottom: 20 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 16 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: COLORS.orangeGlow,
            border: `1px solid ${COLORS.orange}55`,
            color: COLORS.orange,
            fontWeight: 700,
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {step}
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{title}</div>
          <div style={{ fontSize: 13, color: COLORS.textMuted, lineHeight: 1.45 }}>{subtitle}</div>
        </div>
      </div>
      {children}
    </section>
  );
}

function ShortcutCard({ icon, title, description, cta, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: "left",
        padding: 16,
        borderRadius: 10,
        border: `1px solid ${COLORS.border}`,
        background: COLORS.surfaceAlt,
        cursor: "pointer",
        color: "inherit",
        fontFamily: "inherit",
      }}
    >
      <div style={{ fontSize: 22, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 650, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: COLORS.textMuted, lineHeight: 1.45, marginBottom: 10 }}>{description}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.orange }}>{cta}</div>
    </button>
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
              <strong style={{ color: COLORS.text }}>This page (SDR Setup)</strong> — Twilio (Account SID + Auth Token) and Gmail for email
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

function TwilioSetupModal({ open, onClose }) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="twilio-setup-title"
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
            <div id="twilio-setup-title" style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
              Phone & SMS (Twilio)
            </div>
            <p style={{ fontSize: 13, color: COLORS.textMuted, lineHeight: 1.55, margin: 0 }}>
              Connect with Account SID + Auth Token, then pick or buy a number for outbound AI calls and SMS follow-ups.
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

        <TwilioByotCard />

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
 * SDR Setup — how-it-works guide + phone (Twilio) and links to voice/prompt config.
 * Calendar / Meet booking UI is commented out (not in SOW/plan scope).
 */
export default function SDRSetupPage() {
  const navigate = useNavigate();
  const [howOpen, setHowOpen] = useState(false);
  const [twilioOpen, setTwilioOpen] = useState(false);
  const [twilioStatus, setTwilioStatus] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem("catalyst_token");
    if (!token) return;
    fetch("/api/twilio/status", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then(setTwilioStatus)
      .catch(() => {});
  }, [twilioOpen]);

  return (
    <div>
      <div style={{ marginBottom: 24, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>SDR Setup</h2>
          <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "4px 0 0", maxWidth: 760, lineHeight: 1.5 }}>
            Connect services for the AI voice agent, then follow the locked call → SMS → email pipeline.
            Conversation behavior is one system prompt — not separate talk-track or objection modules.
          </p>
        </div>
        <button
          type="button"
          style={{ ...S.btn("ghost"), padding: "8px 14px", fontSize: 12, flexShrink: 0 }}
          onClick={() => setHowOpen(true)}
        >
          How the AI SDR works
        </button>
      </div>

      <HowSdrWorksModal open={howOpen} onClose={() => setHowOpen(false)} onNavigate={navigate} />

      <TwilioSetupModal
        open={twilioOpen}
        onClose={() => setTwilioOpen(false)}
      />

      <section style={{ ...S.card, marginBottom: 20 }}>
        <button
          type="button"
          onClick={() => setTwilioOpen(true)}
          style={{
            width: "100%",
            display: "flex",
            gap: 14,
            alignItems: "flex-start",
            textAlign: "left",
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
            color: "inherit",
            fontFamily: "inherit",
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: COLORS.orangeGlow,
              border: `1px solid ${COLORS.orange}55`,
              color: COLORS.orange,
              fontWeight: 700,
              fontSize: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            1
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Phone & SMS (Twilio)</div>
              {twilioStatus?.connected ? (
                <span style={S.badge(COLORS.green)}>
                  ✓ Connected{twilioStatus.phoneNumber ? ` · ${twilioStatus.phoneNumber}` : ""}
                </span>
              ) : twilioStatus ? (
                <span style={{ fontSize: 11, color: COLORS.textDim }}>Not connected</span>
              ) : null}
            </div>
            <div style={{ fontSize: 13, color: COLORS.textMuted, lineHeight: 1.45 }}>
              Connect your Twilio account (Account SID + Auth Token) and assign a voice/SMS number.
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.orange, marginTop: 10 }}>
              {twilioStatus?.connected ? "Manage Twilio →" : "Connect Twilio →"}
            </div>
          </div>
        </button>
      </section>

      <SetupSection
        step="2"
        title="Email (Gmail)"
        subtitle="Connect your Gmail so SDR follow-up emails send from your own account — n8n-style Google login, not a shared platform mailbox."
      >
        <GmailConnectCard />
      </SetupSection>

      <SetupSection
        step="3"
        title="Calendar (Google)"
        subtitle="Same place as Twilio and Gmail — connect Google Calendar so the agent can check availability and book appointments."
      >
        <CalendarConnections colors={COLORS} styles={S} />
      </SetupSection>

      <SetupSection
        step="4"
        title="Agent content"
        subtitle="The live call agent is a single-prompt system. Set persona, objections, and KB on SDR Agent; pick the ElevenLabs voice on Voice AI."
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
          <ShortcutCard
            icon="🤖"
            title="SDR Agent"
            description="System prompt, knowledge base, SMS/email templates, and sequence thresholds."
            cta="Open SDR Agent →"
            onClick={() => navigate("/sdr")}
          />
          <ShortcutCard
            icon="🎙️"
            title="Voice AI"
            description="Choose and preview the ElevenLabs voice used on outbound calls."
            cta="Open Voice AI →"
            onClick={() => navigate("/voice-ai")}
          />
          <ShortcutCard
            icon="📞"
            title="AI Calling"
            description="Review live call sessions, recordings, and transcripts after setup."
            cta="Open AI Calling →"
            onClick={() => navigate("/calling")}
          />
        </div>
      </SetupSection>
    </div>
  );
}
