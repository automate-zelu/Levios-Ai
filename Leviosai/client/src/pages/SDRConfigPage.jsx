import { useEffect, useState } from "react";
import { COLORS, S } from "../theme.js";
import { sdrApi } from "../api.js";
import { PromptEditor } from "../components/sdr/PromptEditor.jsx";
import { KnowledgeBaseInput } from "../components/sdr/KnowledgeBaseInput.jsx";
import { SMSTemplateEditor } from "../components/sdr/SMSTemplateEditor.jsx";
import { EmailTemplateEditor } from "../components/sdr/EmailTemplateEditor.jsx";
import { ThresholdSettings } from "../components/sdr/ThresholdSettings.jsx";
import { SDRAnalytics } from "../components/sdr/SDRAnalytics.jsx";
import { SdrFlowTimeline, STATUS_COLORS } from "../components/sdr/SdrFlowTimeline.jsx";
import { TierBadge } from "../components/billing/TierBadge.jsx";

const ENROLLMENT_COLORS = STATUS_COLORS;

const EMPTY_FORM = {
  systemPrompt: "", knowledgeBase: "", smsTemplate: "", emailSubject: "", emailBody: "",
  dormantDays: 7, waitCallHrs: 2, waitSmsHrs: 4, reEnrollDays: 30,
  assistantName: "", assistantVoiceId: "",
};

export default function SDRConfigPage({ onNavigateBilling }) {
  const [config, setConfig] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("config");
  const [form, setForm] = useState(EMPTY_FORM);
  const [message, setMessage] = useState("");
  const [expandedEnrollmentId, setExpandedEnrollmentId] = useState(null);
  const [enrollmentDetail, setEnrollmentDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    Promise.all([sdrApi.getConfig(), sdrApi.getAnalytics(), sdrApi.getEnrollments({ limit: 10 })])
      .then(([cfg, analyticsData, enr]) => {
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
        setEnrollments(enr?.data || []);
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

  const toggleEnrollmentDetail = async (enrollmentId) => {
    if (expandedEnrollmentId === enrollmentId) {
      setExpandedEnrollmentId(null);
      setEnrollmentDetail(null);
      return;
    }
    setExpandedEnrollmentId(enrollmentId);
    setDetailLoading(true);
    setEnrollmentDetail(null);
    try {
      const detail = await sdrApi.getEnrollment(enrollmentId);
      setEnrollmentDetail(detail);
    } catch (e) {
      setMessage(e.message || "Failed to load enrollment flow");
      setExpandedEnrollmentId(null);
    } finally {
      setDetailLoading(false);
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
            Configure your AI Sales Development Representative
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

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {["config", "enrollments"].map((t) => (
          <div key={t} style={S.tab(activeTab === t)} onClick={() => setActiveTab(t)}>
            {t === "config" ? "Configuration" : "Enrollments"}
          </div>
        ))}
      </div>

      {activeTab === "config" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
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
      )}

      {activeTab === "enrollments" && (
        <div style={S.card}>
          <div style={S.cardHeader}>
            Recent Enrollments{" "}
            <span style={{ fontSize: 12, color: COLORS.textMuted }}>({enrollments.length} shown)</span>
          </div>
          {enrollments.length === 0 ? (
            <div style={{ textAlign: "center", color: COLORS.textMuted, padding: 40 }}>
              No enrollments yet. Configure and activate the SDR agent to start enrolling dormant leads.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {enrollments.map((e) => {
                const name = [e.leadFirstName, e.leadLastName].filter(Boolean).join(" ") || `Lead #${e.leadId}`;
                const open = expandedEnrollmentId === e.id;
                return (
                  <div key={e.id} style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, overflow: "hidden" }}>
                    <button
                      type="button"
                      onClick={() => toggleEnrollmentDetail(e.id)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "12px 14px",
                        background: COLORS.surfaceAlt,
                        border: "none",
                        cursor: "pointer",
                        color: "inherit",
                        fontFamily: "inherit",
                        display: "flex",
                        gap: 12,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <div style={{ fontSize: 14, fontWeight: 650 }}>{name}</div>
                        <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>
                          {[e.leadEmail, e.leadPhone].filter(Boolean).join(" · ") || `Lead ID ${e.leadId}`}
                        </div>
                      </div>
                      <span style={S.badge(ENROLLMENT_COLORS[e.status] || COLORS.textMuted)}>{e.status}</span>
                      <span style={{ fontSize: 11, color: COLORS.textMuted }}>
                        {new Date(e.updatedAt || e.enrolledAt).toLocaleString()}
                      </span>
                      <span style={{ fontSize: 12, color: COLORS.textMuted }}>{open ? "Hide ▲" : "Flow ▼"}</span>
                    </button>
                    {open && (
                      <div style={{ padding: 16, borderTop: `1px solid ${COLORS.border}` }}>
                        {detailLoading && !enrollmentDetail ? (
                          <div style={{ color: COLORS.textMuted, fontSize: 13 }}>Loading full flow…</div>
                        ) : (
                          <SdrFlowTimeline
                            logs={enrollmentDetail?.logs || []}
                            messages={enrollmentDetail?.messages || []}
                            callSessions={enrollmentDetail?.callSessions || []}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
