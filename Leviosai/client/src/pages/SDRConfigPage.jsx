import { useEffect, useState } from "react";
import { COLORS, S } from "../theme.js";
import { sdrApi } from "../api.js";
import { PromptEditor } from "../components/sdr/PromptEditor.jsx";
import { KnowledgeBaseInput } from "../components/sdr/KnowledgeBaseInput.jsx";
import { SMSTemplateEditor } from "../components/sdr/SMSTemplateEditor.jsx";
import { EmailTemplateEditor } from "../components/sdr/EmailTemplateEditor.jsx";
import { ThresholdSettings } from "../components/sdr/ThresholdSettings.jsx";
import { SDRAnalytics } from "../components/sdr/SDRAnalytics.jsx";
import { TierBadge } from "../components/billing/TierBadge.jsx";

const EMPTY_FORM = {
  systemPrompt: "", knowledgeBase: "", smsTemplate: "", emailSubject: "", emailBody: "",
  dormantDays: 7, waitCallHrs: 2, waitSmsHrs: 4, reEnrollDays: 30,
  assistantName: "", assistantVoiceId: "",
};

export default function SDRConfigPage({ onNavigateBilling }) {
  const [config, setConfig] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [message, setMessage] = useState("");

  useEffect(() => {
    Promise.all([sdrApi.getConfig(), sdrApi.getAnalytics()])
      .then(([cfg, analyticsData]) => {
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
        }
        setAnalytics(analyticsData);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const saved = await sdrApi.saveConfig(form);
      setConfig(saved);
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

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>SDR Agent</h2>
          <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "4px 0 0" }}>
            Configure prompts, templates, and timing. View live enrollments and call flow under AI Calling → Sequences.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <TierBadge tier={analytics?.usage?.tier || config?.tier} active={!!config?.isActive} />
          <button type="button" style={{ ...S.btn("ghost"), padding: "6px 12px", fontSize: 12 }} onClick={handleToggle}>
            {config?.isActive ? "Deactivate" : "Activate"}
          </button>
        </div>
      </div>

      {message && (
        <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 8, background: COLORS.surfaceAlt, border: `1px solid ${COLORS.border}`, fontSize: 13 }}>
          {message}
        </div>
      )}

      <SDRAnalytics analytics={analytics} onUpgrade={onNavigateBilling} />

      <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 8 }}>
        <PromptEditor
          value={form.systemPrompt}
          onChange={(v) => setForm((f) => ({ ...f, systemPrompt: v }))}
        />
        <KnowledgeBaseInput
          value={form.knowledgeBase}
          onChange={(v) => setForm((f) => ({ ...f, knowledgeBase: v }))}
          saving={saving}
        />
        <SMSTemplateEditor
          value={form.smsTemplate}
          onChange={(v) => setForm((f) => ({ ...f, smsTemplate: v }))}
        />
        <EmailTemplateEditor
          subject={form.emailSubject}
          body={form.emailBody}
          onSubjectChange={(v) => setForm((f) => ({ ...f, emailSubject: v }))}
          onBodyChange={(v) => setForm((f) => ({ ...f, emailBody: v }))}
        />
        <ThresholdSettings
          values={form}
          onChange={(key, val) => setForm((f) => ({ ...f, [key]: val }))}
        />
        <button type="button" style={{ ...S.btn("primary"), alignSelf: "flex-start" }} onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save Configuration"}
        </button>
      </div>
    </div>
  );
}
