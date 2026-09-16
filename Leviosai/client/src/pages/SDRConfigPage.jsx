import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { COLORS } from "../theme.js";
import { sdrApi } from "../api.js";
import { PromptEditor } from "../components/sdr/PromptEditor.jsx";
import { KnowledgeBaseInput } from "../components/sdr/KnowledgeBaseInput.jsx";
import { SMSTemplateEditor } from "../components/sdr/SMSTemplateEditor.jsx";
import { EmailTemplateEditor } from "../components/sdr/EmailTemplateEditor.jsx";
import { ThresholdSettings } from "../components/sdr/ThresholdSettings.jsx";
import { SDRAnalytics } from "../components/sdr/SDRAnalytics.jsx";
import { TierBadge } from "../components/billing/TierBadge.jsx";
import TestCallStudio from "../components/sdr/TestCallStudio.jsx";
import AgentStack from "../components/sdr/AgentStack.jsx";
import "./sdr-agent.css";
import "../components/sdr/test-call-studio.css";

const EMPTY_FORM = {
  systemPrompt: "", knowledgeBase: "", smsTemplate: "", emailSubject: "", emailBody: "",
  dormantDays: 7, waitCallHrs: 2, waitSmsHrs: 4, reEnrollDays: 30,
  assistantName: "", assistantVoiceId: "",
};

function formatMmSs(total) {
  if (total == null || !Number.isFinite(Number(total))) return "—";
  const n = Math.max(0, Math.floor(Number(total)));
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function Workbench({ id, tone, title, subtitle, children, split = false }) {
  return (
    <section className="sdr-agent-workbench" id={id}>
      <div className="sdr-agent-workbench-head">
        <div className={`sdr-agent-tone sdr-agent-tone--${tone}`}>{tone}</div>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <div className={split ? "sdr-agent-split" : "sdr-agent-panel"}>{children}</div>
    </section>
  );
}

export default function SDRConfigPage({ onNavigateBilling, onTestCallActive }) {
  const navigate = useNavigate();
  const [config, setConfig] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [credits, setCredits] = useState(null);
  const [allowPaid, setAllowPaid] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);

  const setTestCall = (open) => {
    setTestOpen(open);
    onTestCallActive?.(open);
    if (!open) {
      setAllowPaid(false);
      sdrApi.getTestCredits().then(setCredits).catch(() => {});
    }
  };

  const startTestCall = async () => {
    try {
      const snap = await sdrApi.getTestCredits();
      setCredits(snap);
      if (!snap.allowed) {
        setMessage(snap.message);
        return;
      }
      setConsentOpen(true);
    } catch (e) {
      setMessage(e.message || "Could not check test credits");
    }
  };

  const beginTestCall = (usePaid) => {
    setAllowPaid(!!usePaid);
    setConsentOpen(false);
    setMessage("");
    setTestCall(true);
  };

  const declinePaidCredits = () => {
    setConsentOpen(false);
    setAllowPaid(false);
    if (credits?.usingPaid) {
      setMessage(
        "Free test minutes are used up. You declined using paid calling minutes, so the test did not start and no monthly call credits were consumed."
      );
    }
  };

  useEffect(() => {
    return () => onTestCallActive?.(false);
  }, [onTestCallActive]);

  useEffect(() => {
    Promise.all([sdrApi.getConfig(), sdrApi.getAnalytics(), sdrApi.getTestCredits()])
      .then(([cfg, analyticsData, creditSnap]) => {
        if (cfg) {
          setConfig(cfg);
          setForm({
            systemPrompt: cfg.systemPrompt || "",
            knowledgeBase: cfg.knowledgeBase || "",
            smsTemplate: cfg.smsTemplate || "",
            emailSubject: cfg.emailSubject || "",
            emailBody: cfg.emailBody || "",
            dormantDays: cfg.dormantDays ?? 7,
            waitCallHrs: cfg.waitCallHrs ?? 2,
            waitSmsHrs: cfg.waitSmsHrs ?? 4,
            reEnrollDays: cfg.reEnrollDays ?? 30,
            assistantName: cfg.assistantName || "",
            assistantVoiceId: cfg.assistantVoiceId || "",
          });
          setDirty(false);
        }
        setAnalytics(analyticsData);
        if (creditSnap) setCredits(creditSnap);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const patchForm = (updater) => {
    setForm((f) => (typeof updater === "function" ? updater(f) : { ...f, ...updater }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const saved = await sdrApi.saveConfig(form);
      setConfig(saved);
      setDirty(false);
      setMessage("SDR configuration saved.");
    } catch (e) {
      setMessage(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async () => {
    try {
      const updated = await sdrApi.setStatus(!config?.isActive);
      setConfig(updated);
    } catch (e) {
      setMessage(e.message || "Status update failed");
    }
  };

  if (loading) {
    return (
      <div className="loading-state">
        <div className="loading-spinner" />
        <div style={{ fontSize: 14, color: COLORS.textMuted }}>Loading SDR Agent…</div>
      </div>
    );
  }

  const saveButton = (
    <button
      type="button"
      className="sdr-agent-btn sdr-agent-btn--primary"
      onClick={handleSave}
      disabled={saving}
    >
      {saving ? "Saving…" : dirty ? "Save configuration" : "Saved"}
    </button>
  );

  return (
    <>
    <div className="sdr-agent">
      <nav className="sdr-agent-toolbar" aria-label="SDR Agent actions">
        <div className="sdr-agent-toolbar-label">SDR Agent</div>
        <div className="sdr-agent-actions">
          <button
            type="button"
            className="sdr-agent-btn sdr-agent-btn--test"
            onClick={startTestCall}
            disabled={testOpen || consentOpen || !form.systemPrompt || credits?.allowed === false}
          >
            Test call
          </button>
          <TierBadge tier={analytics?.usage?.tier || config?.tier} active={!!config?.isActive} />
          <button type="button" className="sdr-agent-btn sdr-agent-btn--ghost" onClick={handleToggle}>
            {config?.isActive ? "Deactivate" : "Activate"}
          </button>
          {saveButton}
        </div>
      </nav>
      <header className="sdr-agent-hero">
        <p className="sdr-agent-hero-copy">Prompt, knowledge, and follow-ups. Channels stay on SDR Setup.</p>
        {analytics && (
          <div className="sdr-agent-metrics">
            <div className="sdr-agent-metric">
              <span>Enrollments</span>
              <strong>{analytics.totalEnrollments ?? "—"}</strong>
            </div>
            <div className="sdr-agent-metric">
              <span>Bookings</span>
              <strong>{analytics.booked ?? "—"}</strong>
            </div>
            <div className="sdr-agent-metric">
              <span>Rate</span>
              <strong>{analytics.bookedRate != null ? `${analytics.bookedRate}%` : "—"}</strong>
            </div>
            <div className="sdr-agent-metric">
              <span>Sequences</span>
              <strong>{analytics.active ?? "—"}</strong>
            </div>
            {credits && (
              <div className="sdr-agent-metric">
                <span>Test time</span>
                <strong>
                  {formatMmSs(credits.testRemainingSeconds ?? credits.testRemaining)}
                </strong>
              </div>
            )}
          </div>
        )}
      </header>

      <AgentStack compact />

      {message && <div className="sdr-agent-msg">{message}</div>}

      <nav className="sdr-agent-jump" aria-label="On this page">
        <a href="#agent-prompt">Prompt</a>
        <a href="#agent-kb">Knowledge</a>
        <a href="#agent-followups">Follow-ups</a>
        <a href="#agent-timing">Timing</a>
        <Link to="/sdr-setup">Channels</Link>
      </nav>

      <SDRAnalytics analytics={analytics} compact />

      <Workbench
        id="agent-prompt"
        tone="prompt"
        title="System prompt"
        subtitle="What the agent says on the call. One prompt — persona, objections, and close."
      >
        <PromptEditor
          bare
          value={form.systemPrompt}
          onChange={(v) => patchForm((f) => ({ ...f, systemPrompt: v }))}
          calendarContext={null}
        />
      </Workbench>

      <div className="sdr-agent-cal">
        <div>
          <strong>Calendar booking</strong>
          <span>Availability window and live tools are configured on SDR Setup, not in this prompt editor.</span>
        </div>
        <button
          type="button"
          className="sdr-agent-btn sdr-agent-btn--ghost"
          onClick={() => navigate("/sdr-setup#setup-calendar")}
        >
          Open booking settings
        </button>
      </div>

      <Workbench
        id="agent-kb"
        tone="kb"
        title="Knowledge base"
        subtitle="Facts the agent can retrieve mid-call. Save after edits so search embeddings rebuild."
      >
        <KnowledgeBaseInput
          bare
          value={form.knowledgeBase}
          onChange={(v) => patchForm((f) => ({ ...f, knowledgeBase: v }))}
          saving={saving}
        />
      </Workbench>

      <section className="sdr-agent-workbench" id="agent-followups">
        <div className="sdr-agent-workbench-head">
          <div className="sdr-agent-tone sdr-agent-tone--sms">follow-ups</div>
          <h2>SMS & email templates</h2>
          <p>Sent after a missed or incomplete call. Type @ to insert lead variables.</p>
        </div>
        <div className="sdr-agent-split">
          <div className="sdr-agent-panel">
            <div className="sdr-agent-tone sdr-agent-tone--sms" style={{ marginBottom: 10 }}>SMS</div>
            <SMSTemplateEditor
              bare
              value={form.smsTemplate}
              onChange={(v) => patchForm((f) => ({ ...f, smsTemplate: v }))}
            />
          </div>
          <div className="sdr-agent-panel">
            <div className="sdr-agent-tone sdr-agent-tone--mail" style={{ marginBottom: 10 }}>Email</div>
            <EmailTemplateEditor
              bare
              subject={form.emailSubject}
              body={form.emailBody}
              onSubjectChange={(v) => patchForm((f) => ({ ...f, emailSubject: v }))}
              onBodyChange={(v) => patchForm((f) => ({ ...f, emailBody: v }))}
            />
          </div>
        </div>
      </section>

      <Workbench
        id="agent-timing"
        tone="time"
        title="Sequence timing"
        subtitle="How long to wait between call, SMS, email, and re-enrollment."
      >
        <ThresholdSettings
          bare
          values={form}
          onChange={(key, val) => patchForm((f) => ({ ...f, [key]: val }))}
        />
      </Workbench>

    </div>
    <TestCallStudio
      open={testOpen}
      form={form}
      allowPaid={allowPaid}
      onClose={() => setTestCall(false)}
    />
    {consentOpen && credits && (
      <div className="test-call-consent" role="dialog" aria-modal="true" aria-labelledby="test-call-consent-title">
        <div className="test-call-consent-card">
          <p className="test-call-consent-kicker">Each test call</p>
          <h2 id="test-call-consent-title">Start this rehearsal?</h2>
          <p>
            This rehearsal is billed by the second after you allow the microphone and speaker. The agent uses the same ElevenLabs voice as live calls.
          </p>
          {credits.usingPaid ? (
            <p>
              Free test time is used up. This call will use paid monthly calling time ({formatMmSs(credits.paidRemainingSeconds)}) unless you cancel.
            </p>
          ) : (
            <p>
              You have <strong>{formatMmSs(credits.testRemainingSeconds)}</strong> free test time of {credits.testLimitMinutes} minutes. This call uses that first.
              If it runs out mid-call and you do not allow paid minutes, the rehearsal ends and monthly credits stay untouched.
            </p>
          )}
          <div className="test-call-consent-actions">
            <button type="button" className="sdr-agent-btn sdr-agent-btn--ghost" onClick={declinePaidCredits}>
              Cancel
            </button>
            {!credits.usingPaid && (
              <button type="button" className="sdr-agent-btn sdr-agent-btn--ghost" onClick={() => beginTestCall(false)}>
                Free time only
              </button>
            )}
            <button type="button" className="sdr-agent-btn sdr-agent-btn--primary" onClick={() => beginTestCall(true)}>
              {credits.usingPaid ? "Use monthly minutes" : "Allow paid if free runs out"}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
