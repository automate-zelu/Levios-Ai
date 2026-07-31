import { useEffect, useState } from "react";
import { COLORS, S } from "../theme.js";
import {
  ONBOARDING_STEP_LABELS,
  clampOnboardingStep,
  readStoredOnboardingStep,
  writeStoredOnboardingStep,
  clearOnboardingStorage,
} from "../lib/onboarding.js";
import { OnboardingStep1 } from "../components/onboarding/OnboardingStep1.jsx";
import { OnboardingStep2 } from "../components/onboarding/OnboardingStep2.jsx";
import { OnboardingStep3 } from "../components/onboarding/OnboardingStep3.jsx";

function BrandMark() {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
      <span
        style={{
          fontFamily: "Outfit, sans-serif",
          fontWeight: 800,
          fontSize: 18,
          letterSpacing: "-0.02em",
          background: `linear-gradient(135deg, ${COLORS.orangeLight}, ${COLORS.orangeDark})`,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}
      >
        Leviosai
      </span>
    </div>
  );
}

function ProgressBar({ step }) {
  const dots = [];
  ONBOARDING_STEP_LABELS.forEach((label, i) => {
    if (i > 0) {
      dots.push(
        <div
          key={`line-${i}`}
          style={{
            height: 2,
            flex: 1,
            minWidth: 24,
            maxWidth: 64,
            background: i <= step ? COLORS.orange : COLORS.border,
            transition: "background 0.3s",
          }}
        />
      );
    }
    const done = i < step;
    const active = i === step;
    dots.push(
      <div key={`dot-${i}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 13,
            background: done ? COLORS.orange : active ? COLORS.orangeGlow : COLORS.surfaceAlt,
            color: done ? "#fff" : active ? COLORS.orange : COLORS.textMuted,
            border: `2px solid ${done || active ? COLORS.orange : COLORS.border}`,
            transition: "all 0.3s",
            flexShrink: 0,
          }}
        >
          {done ? "✓" : i + 1}
        </div>
        <div
          style={{
            fontSize: 10,
            color: active ? COLORS.orange : done ? COLORS.textMuted : COLORS.textDim,
            fontWeight: active ? 600 : 400,
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </div>
      </div>
    );
  });
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", gap: 0, marginBottom: 28 }}>
      {dots}
    </div>
  );
}

/**
 * 3-step SDR onboarding: Subscribe → Configure → Activate (plan §13.4).
 * Step index persisted in localStorage; completion persisted via /api/auth/onboarding/complete.
 */
export default function SDROnboarding({ user, onComplete }) {
  const [step, setStep] = useState(() => readStoredOnboardingStep());
  const [readyToLeave, setReadyToLeave] = useState(false);

  useEffect(() => {
    writeStoredOnboardingStep(clampOnboardingStep(step));
  }, [step]);

  const go = (next) => setStep(clampOnboardingStep(next));

  const handleFinished = () => {
    clearOnboardingStorage();
    setReadyToLeave(true);
    onComplete?.();
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px 16px",
        background: `radial-gradient(ellipse at 50% 0%, ${COLORS.orangeGlow}, transparent 55%), ${COLORS.bg}`,
        color: COLORS.text,
        fontFamily: "'DM Sans', system-ui, sans-serif",
      }}
    >
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Outfit:wght@700;800&display=swap" rel="stylesheet" />
      <div
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 20,
          padding: "32px 36px",
          width: "100%",
          maxWidth: step === 1 ? 720 : 560,
          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
          transition: "max-width 0.25s ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <BrandMark />
          <span style={{ fontSize: 11, color: COLORS.textDim, fontWeight: 500 }}>
            Step {step + 1} of {ONBOARDING_STEP_LABELS.length}
          </span>
        </div>

        <ProgressBar step={step} />

        <div style={{ minHeight: 280, maxHeight: "70vh", overflowY: "auto", paddingRight: 4 }}>
          {step === 0 && (
            <OnboardingStep1
              onSubscribed={() => go(1)}
            />
          )}
          {step === 1 && (
            <OnboardingStep2
              user={user}
              onConfigured={() => go(2)}
            />
          )}
          {step === 2 && (
            <OnboardingStep3
              onComplete={handleFinished}
            />
          )}
        </div>

        {step > 0 && step < 2 && !readyToLeave && (
          <div style={{ marginTop: 20 }}>
            <button type="button" style={S.btn("ghost")} onClick={() => go(step - 1)}>
              ← Back
            </button>
          </div>
        )}

        {step === 0 && (
          <p style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 20, textAlign: "center" }}>
            Welcome{user?.firstName ? `, ${user.firstName}` : ""}. Let&apos;s get your AI SDR live in three steps.
          </p>
        )}
      </div>
    </div>
  );
}
