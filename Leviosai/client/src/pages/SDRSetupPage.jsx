import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { COLORS, S } from "../theme.js";
import CalendarConnections from "../components/calendar/CalendarConnections.jsx";
import TwilioByotCard from "../components/sdr/TwilioByotCard.jsx";

const WEBHOOKS = [
  {
    label: "Voice connect (inbound / answer)",
    path: "/api/call/connect",
    note: "Twilio voice webhook for AI media stream",
  },
  {
    label: "Call status",
    path: "/api/webhooks/twilio/call-status",
    note: "Completed, busy, no-answer, failed",
  },
  {
    label: "Inbound SMS",
    path: "/api/webhooks/twilio/sms",
    note: "SMS reply matching for SDR sequences",
  },
];

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
    body: "Answered / booked → sequence can complete and optionally book Google Calendar. No-answer / voicemail → wait, then SMS. Busy → short retries, then SMS. Failed → logged and fall-through per rules.",
  },
  {
    id: "sms",
    title: "4. SMS follow-up",
    body: "After wait-after-call hours, Twilio sends your SMS template ({{lead_name}}). Reply → sequence stops as engaged. No reply → wait-after-SMS hours, then email.",
  },
  {
    id: "email",
    title: "5. Email follow-up",
    body: "Your email subject/body are sent via Resend/SendGrid. Reply → engaged. Timeout → enrollment marked exhausted; re-enrollment waits re-enroll days.",
  },
  {
    id: "crm",
    title: "6. CRM + calling panel",
    body: "Every step is written to SDR logs. Call recordings and transcripts appear under AI Calling. Bookings sync to the Google Calendar connected here.",
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

function HowSdrWorks({ onNavigate }) {
  const [open, setOpen] = useState(true);

  return (
    <section style={{ ...S.card, marginBottom: 20 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: "inherit",
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>How the AI SDR works</div>
          <div style={{ fontSize: 13, color: COLORS.textMuted, lineHeight: 1.45 }}>
            Locked pipeline: one engine for every workspace. You configure content (prompt, voice, templates) — not the sequence order.
          </div>
        </div>
        <span style={{ fontSize: 12, color: COLORS.textMuted, flexShrink: 0 }}>{open ? "Hide ▲" : "Show ▼"}</span>
      </button>

      {open && (
        <div style={{ marginTop: 18 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 8,
              marginBottom: 18,
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
              marginBottom: 14,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 8 }}>Where to configure each piece</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: COLORS.textMuted, lineHeight: 1.7 }}>
              <li>
                <strong style={{ color: COLORS.text }}>This page (SDR Setup)</strong> — Twilio phone/SMS, Google Calendar, webhook URLs
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
                <strong style={{ color: COLORS.text }}>Billing</strong> — subscription required before SDR can go live
              </li>
            </ul>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" style={{ ...S.btn("primary"), padding: "8px 14px", fontSize: 12 }} onClick={() => onNavigate("/sdr")}>
              Configure SDR Agent
            </button>
            <button type="button" style={{ ...S.btn("ghost"), padding: "8px 14px", fontSize: 12 }} onClick={() => onNavigate("/billing")}>
              Open Billing
            </button>
            <button type="button" style={{ ...S.btn("ghost"), padding: "8px 14px", fontSize: 12 }} onClick={() => onNavigate("/calling")}>
              View call logs
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * SDR Setup — how-it-works guide + phone (Twilio), calendar, and links to voice/prompt config.
 */
export default function SDRSetupPage() {
  const navigate = useNavigate();
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>SDR Setup</h2>
        <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "4px 0 0", maxWidth: 760, lineHeight: 1.5 }}>
          Connect services for the AI voice agent, then follow the locked call → SMS → email pipeline.
          Conversation behavior is one system prompt — not separate talk-track or objection modules.
        </p>
      </div>

      <HowSdrWorks onNavigate={navigate} />

      <SetupSection
        step="1"
        title="Phone & SMS (Twilio)"
        subtitle="Connect your Twilio account and assign a voice/SMS number used for outbound AI calls and follow-ups."
      >
        <TwilioByotCard />
      </SetupSection>

      <SetupSection
        step="2"
        title="Calendar bookings"
        subtitle="Connect Google Calendar so the agent can book appointments when a lead agrees on a call."
      >
        <CalendarConnections colors={COLORS} styles={S} />
      </SetupSection>

      <SetupSection
        step="3"
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

      <SetupSection
        step="4"
        title="Twilio webhook URLs"
        subtitle="Point your Twilio number (or messaging service) at these endpoints on this deployment."
      >
        <div style={{ display: "grid", gap: 10 }}>
          {WEBHOOKS.map((w) => {
            const url = `${origin}${w.path}`;
            return (
              <div
                key={w.path}
                style={{
                  padding: 12,
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  background: COLORS.surfaceAlt,
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{w.label}</div>
                  <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>{w.note}</div>
                  <code style={{ display: "block", fontSize: 12, color: COLORS.teal, marginTop: 6, wordBreak: "break-all" }}>
                    {url}
                  </code>
                </div>
                <button
                  type="button"
                  style={{ ...S.btn("ghost"), padding: "6px 12px", fontSize: 11, flexShrink: 0 }}
                  onClick={() => copy(url)}
                >
                  Copy
                </button>
              </div>
            );
          })}
        </div>
      </SetupSection>
    </div>
  );
}
