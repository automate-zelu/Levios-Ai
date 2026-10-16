import { useEffect, useState } from "react";
import { COLORS, S } from "../theme.js";
import {
  ONBOARDING_STEP_LABELS,
  LEVVI_LAST_STEP,
  clampOnboardingStep,
  readStoredOnboardingStep,
  writeStoredOnboardingStep,
  clearOnboardingStorage,
  readOnboardingDraft,
  writeOnboardingDraft,
  firstIncompleteLevviStep,
} from "../lib/onboarding.js";
import { leadsApi, sdrApi, billingApi, settingsApi } from "../api.js";

const LEVVI_DRAFT_SETTING = "levvi.onboardingDraft";
const LEVVI_STEP_SETTING = "levvi.onboardingStep";
import { OnboardingStep2 } from "../components/onboarding/OnboardingStep2.jsx";
import {
  LevviWelcome,
  LevviExplain,
  LevviBusiness,
  LevviAvailability,
  LevviChannels,
  LevviImportLeads,
  LevviKnowledge,
} from "../components/onboarding/LevviSteps.jsx";

function BrandMark() {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
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
        Levvi
      </span>
      <span style={{ fontSize: 11, color: COLORS.textDim, fontWeight: 500 }}>× Catalyst</span>
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
            minWidth: 8,
            maxWidth: 28,
            background: i <= step ? COLORS.orange : COLORS.border,
            transition: "background 0.3s",
          }}
        />
      );
    }
    const done = i < step;
    const active = i === step;
    dots.push(
      <div key={`dot-${i}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 11,
            background: done ? COLORS.orange : active ? COLORS.orangeGlow : COLORS.surfaceAlt,
            color: done ? "#fff" : active ? COLORS.orange : COLORS.textMuted,
            border: `2px solid ${done || active ? COLORS.orange : COLORS.border}`,
            transition: "all 0.3s",
            flexShrink: 0,
          }}
          title={label}
        >
          {done ? "✓" : i + 1}
        </div>
        <div
          style={{
            fontSize: 9,
            color: active ? COLORS.orange : done ? COLORS.textMuted : COLORS.textDim,
            fontWeight: active ? 600 : 400,
            whiteSpace: "nowrap",
            maxWidth: 56,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </div>
      </div>
    );
  });
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        gap: 0,
        marginBottom: 24,
        overflowX: "auto",
        paddingBottom: 4,
      }}
    >
      {dots}
    </div>
  );
}

/**
 * P4 Levvi first-login wizard (8 steps).
 * Progress + draft in localStorage; completion via /api/auth/onboarding/complete.
 */
export default function SDROnboarding({ user, onComplete }) {
  const [step, setStep] = useState(() => readStoredOnboardingStep());
  const [draft, setDraft] = useState(() => readOnboardingDraft());
  const [readyToLeave, setReadyToLeave] = useState(false);
  const [resumed, setResumed] = useState(false);

  // Persist locally + to org settings so login on another device resumes Levvi
  useEffect(() => {
    if (!resumed) return;
    const clamped = clampOnboardingStep(step);
    writeStoredOnboardingStep(clamped);
    writeOnboardingDraft(draft);
    const t = setTimeout(() => {
      settingsApi
        .patch({
          [LEVVI_DRAFT_SETTING]: draft,
          [LEVVI_STEP_SETTING]: clamped,
        })
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [step, draft, resumed]);

  // Resume / skip completed steps on return (localStorage + server settings)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [leads, config, billing, settingsRes] = await Promise.all([
          leadsApi.list().catch(() => []),
          sdrApi.getConfig().catch(() => null),
          billingApi.getStatus().catch(() => null),
          settingsApi.get().catch(() => null),
        ]);
        if (cancelled) return;

        const remote = settingsRes?.settings || {};
        const remoteDraft =
          remote[LEVVI_DRAFT_SETTING] && typeof remote[LEVVI_DRAFT_SETTING] === "object"
            ? remote[LEVVI_DRAFT_SETTING]
            : {};
        const localDraft = readOnboardingDraft();
        const mergedDraft = { ...remoteDraft, ...localDraft };
        setDraft(mergedDraft);
        writeOnboardingDraft(mergedDraft);

        const leadCount = Array.isArray(leads) ? leads.length : leads?.leads?.length || 0;
        const storedLocal = readStoredOnboardingStep();
        const storedRemote = clampOnboardingStep(remote[LEVVI_STEP_SETTING] ?? 0);
        const stored = Math.max(storedLocal, storedRemote);
        const incomplete = firstIncompleteLevviStep({
          draft: mergedDraft,
          billing,
          config,
          leadCount,
        });
        // Prefer first incomplete when progress is ahead of draft; else resume stored step
        if (incomplete > stored) {
          setStep(incomplete);
        } else if (stored <= 1 && incomplete > 2) {
          setStep(incomplete);
        } else {
          setStep(stored);
        }
      } catch {
        /* keep stored step */
      } finally {
        if (!cancelled) setResumed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const go = (next) => setStep(clampOnboardingStep(next));
  const updateDraft = (next) => setDraft(next || {});

  const handleFinished = () => {
    clearOnboardingStorage();
    settingsApi
      .patch({
        [LEVVI_DRAFT_SETTING]: {},
        [LEVVI_STEP_SETTING]: null,
      })
      .catch(() => {});
    setReadyToLeave(true);
    onComplete?.();
  };

  const wide = step === 6 || step === 7;

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
          padding: "28px 32px",
          width: "100%",
          maxWidth: wide ? 720 : 560,
          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
          transition: "max-width 0.25s ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <BrandMark />
          <span style={{ fontSize: 11, color: COLORS.textDim, fontWeight: 500 }}>
            Step {step + 1} of {ONBOARDING_STEP_LABELS.length}
          </span>
        </div>

        <ProgressBar step={step} />

        {!resumed ? (
          <p role="status" style={{ color: COLORS.textMuted, fontSize: 14 }}>Resuming Levvi setup…</p>
        ) : (
          <div style={{ minHeight: 260, maxHeight: "70vh", overflowY: "auto", paddingRight: 4 }}>
            {step === 0 && <LevviWelcome user={user} onNext={() => go(1)} />}
            {step === 1 && <LevviExplain onNext={() => go(2)} />}
            {step === 2 && (
              <LevviBusiness draft={draft} onDraftChange={updateDraft} onNext={() => go(3)} />
            )}
            {step === 3 && (
              <LevviAvailability draft={draft} onDraftChange={updateDraft} onNext={() => go(4)} />
            )}
            {step === 4 && (
              <LevviChannels onNext={() => go(5)} onSkip={() => go(5)} />
            )}
            {step === 5 && (
              <LevviImportLeads draft={draft} onDraftChange={updateDraft} onNext={() => go(6)} />
            )}
            {step === 6 && (
              <OnboardingStep2
                user={user}
                companyHint={draft.companyName}
                hideKnowledgeBase
                onConfigured={() => go(7)}
              />
            )}
            {step === 7 && (
              <LevviKnowledge
                draft={draft}
                onDraftChange={updateDraft}
                onComplete={handleFinished}
              />
            )}
          </div>
        )}

        {resumed && step > 0 && step < LEVVI_LAST_STEP && !readyToLeave && (
          <div style={{ marginTop: 18 }}>
            <button type="button" style={S.btn("ghost")} onClick={() => go(step - 1)}>
              ← Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
