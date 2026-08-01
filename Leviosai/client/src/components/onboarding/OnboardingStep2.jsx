import { useEffect, useState } from "react";
import { COLORS, S } from "../../theme.js";
import { sdrApi } from "../../api.js";
import { PromptEditor } from "../sdr/PromptEditor.jsx";
import { KnowledgeBaseInput } from "../sdr/KnowledgeBaseInput.jsx";
import { SMSTemplateEditor } from "../sdr/SMSTemplateEditor.jsx";
import { EmailTemplateEditor } from "../sdr/EmailTemplateEditor.jsx";
import { ThresholdSettings } from "../sdr/ThresholdSettings.jsx";

function defaultsFor(user) {
  const firstName = user?.firstName || "Your";
  const orgLabel = `${firstName}'s Company`;
  return {
    systemPrompt:
      `You are an AI sales development representative for ${orgLabel}. ` +
      `You are warm, professional, and goal-driven. ` +
      `Your job is to re-engage leads, answer questions, handle objections calmly, and book appointments. ` +
      `Keep every response under 3 sentences and always end with a clear next step or question.`,
    knowledgeBase: "",
    smsTemplate:
      `Hi {{first_name}} — it's ${orgLabel}. I tried reaching you earlier and would love to reconnect. ` +
      `Do you have 10 minutes this week for a quick chat? Reply YES if you're open, or tell me a better time.`,
    emailSubject: `{{first_name}}, quick check-in from ${orgLabel}`,
    emailBody:
      `Hi {{first_name}},\n\n` +
      `I hope you're doing well. I reached out recently and wanted to follow up personally from ${orgLabel}.\n\n` +
      `Would you be open to a quick 10-minute call this week? If yes, reply with a couple of times that work — or tell me if now isn't a fit.\n\n` +
      `Looking forward to hearing from you,\n` +
      `${firstName}\n${orgLabel}`,
    dormantDays: 7,
    waitCallHrs: 2,
    waitSmsHrs: 4,
    reEnrollDays: 30,
  };
}

/**
 * Step 2 — Configure SDR via PUT /api/sdr/config.
 */
export function OnboardingStep2({ user, onConfigured }) {
  const [form, setForm] = useState(() => defaultsFor(user));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    sdrApi.getConfig()
      .then((cfg) => {
        if (cancelled || !cfg) return;
        setForm((prev) => ({
          ...prev,
          systemPrompt: cfg.systemPrompt || prev.systemPrompt,
          knowledgeBase: cfg.knowledgeBase || "",
          smsTemplate: cfg.smsTemplate || prev.smsTemplate,
          emailSubject: cfg.emailSubject || prev.emailSubject,
          emailBody: cfg.emailBody || prev.emailBody,
          dormantDays: cfg.dormantDays ?? prev.dormantDays,
          waitCallHrs: cfg.waitCallHrs ?? prev.waitCallHrs,
          waitSmsHrs: cfg.waitSmsHrs ?? prev.waitSmsHrs,
          reEnrollDays: cfg.reEnrollDays ?? prev.reEnrollDays,
        }));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    setSaving(true);
    setErr("");
    try {
      await sdrApi.saveConfig({
        systemPrompt: form.systemPrompt,
        knowledgeBase: form.knowledgeBase || null,
        smsTemplate: form.smsTemplate,
        emailSubject: form.emailSubject,
        emailBody: form.emailBody,
        dormantDays: Number(form.dormantDays) || 7,
        waitCallHrs: Number(form.waitCallHrs) || 2,
        waitSmsHrs: Number(form.waitSmsHrs) || 4,
        reEnrollDays: Number(form.reEnrollDays) || 30,
      });
      onConfigured?.();
    } catch (e) {
      setErr(e.message || "Failed to save SDR config");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p style={{ color: COLORS.textMuted, fontSize: 14 }}>Loading SDR config…</p>;
  }

  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px" }}>Configure your AI SDR</h3>
      <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "0 0 18px", lineHeight: 1.5 }}>
        Set the agent prompt, templates, and dormancy thresholds. You can refine these later in SDR Agent settings.
      </p>

      <PromptEditor value={form.systemPrompt} onChange={(v) => set("systemPrompt", v)} />
      <KnowledgeBaseInput value={form.knowledgeBase} onChange={(v) => set("knowledgeBase", v)} />
      <SMSTemplateEditor value={form.smsTemplate} onChange={(v) => set("smsTemplate", v)} />
      <EmailTemplateEditor
        subject={form.emailSubject}
        body={form.emailBody}
        onSubjectChange={(v) => set("emailSubject", v)}
        onBodyChange={(v) => set("emailBody", v)}
      />
      <ThresholdSettings
        values={{
          dormantDays: form.dormantDays,
          waitCallHrs: form.waitCallHrs,
          waitSmsHrs: form.waitSmsHrs,
          reEnrollDays: form.reEnrollDays,
        }}
        onChange={(key, value) => set(key, value)}
      />

      {err && (
        <div style={{ marginBottom: 12, padding: "9px 13px", borderRadius: 8, background: `${COLORS.red}20`, color: COLORS.red, fontSize: 12 }}>
          {err}
        </div>
      )}

      <button
        type="button"
        style={{ ...S.btn("primary"), width: "100%", opacity: saving ? 0.7 : 1 }}
        onClick={save}
        disabled={saving}
      >
        {saving ? "Saving…" : "Save configuration →"}
      </button>
    </div>
  );
}
