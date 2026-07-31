import { useState } from "react";
import { COLORS, S } from "../../theme.js";
import { sdrApi, auth } from "../../api.js";

/**
 * Step 3 — Activate SDR (PATCH isActive) and persist onboardingComplete.
 */
export function OnboardingStep3({ onComplete }) {
  const [activate, setActivate] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const finish = async () => {
    setSaving(true);
    setErr("");
    try {
      if (activate) {
        await sdrApi.setStatus(true);
      }
      await auth.completeOnboarding();
      setDone(true);
      onComplete?.({ activated: activate });
    } catch (e) {
      setErr(e.message || "Failed to finish onboarding");
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <div style={{ textAlign: "center", padding: "8px 0" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
        <h3 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 8px" }}>You&apos;re all set</h3>
        <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "0 0 20px", lineHeight: 1.5 }}>
          {activate
            ? "Your AI SDR is active and ready to engage enrolled leads."
            : "Setup is complete. Activate your SDR anytime from SDR Agent settings."}
        </p>
        <p style={{ fontSize: 12, color: COLORS.textDim }}>
          Tip: open <strong style={{ color: COLORS.orange }}>SDR Agent</strong> to refine prompts and view the execution log.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px" }}>Activate your AI SDR</h3>
      <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "0 0 20px", lineHeight: 1.5 }}>
        Turn on the agent to start the call → SMS → email sequence for enrolled dormant leads.
      </p>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "16px 18px",
          background: COLORS.surfaceAlt,
          borderRadius: 12,
          border: `1px solid ${COLORS.border}`,
          marginBottom: 20,
        }}
      >
        <div style={{ flex: 1, textAlign: "left" }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Activate AI SDR now?</div>
          <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 2, lineHeight: 1.4 }}>
            Your agent will automatically engage enrolled leads.
          </div>
        </div>
        <button
          type="button"
          aria-pressed={activate}
          onClick={() => setActivate((a) => !a)}
          style={{
            width: 48,
            height: 26,
            borderRadius: 13,
            border: "none",
            cursor: "pointer",
            background: activate ? COLORS.green : COLORS.border,
            position: "relative",
            transition: "background 0.2s",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 3,
              left: activate ? 24 : 3,
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "#fff",
              transition: "left 0.2s",
              pointerEvents: "none",
            }}
          />
        </button>
      </div>

      {err && (
        <div style={{ marginBottom: 12, padding: "9px 13px", borderRadius: 8, background: `${COLORS.red}20`, color: COLORS.red, fontSize: 12 }}>
          {err}
        </div>
      )}

      <button
        type="button"
        style={{ ...S.btn("primary"), width: "100%", opacity: saving ? 0.7 : 1 }}
        onClick={finish}
        disabled={saving}
      >
        {saving ? "Finishing…" : activate ? "Activate & enter dashboard →" : "Enter dashboard →"}
      </button>
    </div>
  );
}
