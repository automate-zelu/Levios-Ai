import { useEffect, useState } from "react";
import { COLORS, S } from "../../theme.js";
import { billingApi } from "../../api.js";

const POLL_MS = 3000;

/**
 * Step 1 — Activate with the global monthly retainer (no tier plan picker).
 */
export function OnboardingStep1({ onSubscribed }) {
  const [billing, setBilling] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const refresh = async () => {
    try {
      const status = await billingApi.getStatus();
      setBilling(status);
      return status;
    } catch (e) {
      setErr(e.message || "Failed to load billing");
      return null;
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const status = await refresh();
      if (cancelled) return;
      setLoading(false);
      if (status?.sdr?.isActive) onSubscribed?.();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (billing?.sdr?.isActive) return undefined;
    const id = setInterval(async () => {
      const status = await refresh();
      if (status?.sdr?.isActive) onSubscribed?.();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [billing?.sdr?.isActive]);

  const startCheckout = async () => {
    setBusy(true);
    setErr("");
    try {
      const origin = window.location.origin;
      const res = await billingApi.checkout(
        "monthly",
        `${origin}/?onboarding=1&checkout=success`,
        `${origin}/?onboarding=1&checkout=cancel`
      );
      if (res?.url) {
        window.location.href = res.url;
        return;
      }
      setErr("Checkout did not return a URL");
    } catch (e) {
      setErr(e.message || "Checkout failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <p role="status" style={{ color: COLORS.textMuted, fontSize: 14 }}>Checking billing…</p>;
  }

  if (billing?.sdr?.isActive) {
    return (
      <div style={{ textAlign: "center", padding: "12px 0" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden="true">✓</div>
        <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>Billing active</h3>
        <p style={{ color: COLORS.textMuted, fontSize: 13, margin: 0 }}>
          Your workspace is live. Continue to configure your AI SDR.
        </p>
      </div>
    );
  }

  const commercial = billing?.commercialPricing;
  const monthlyLabel = commercial?.monthlyFeeEnabled
    ? `${commercial.monthlyFeeLabel} / mo`
    : "Monthly fee off for your account";
  const apptLabel = commercial?.appointmentFeeEnabled
    ? `${commercial.appointmentFeeLabel} per booked appointment`
    : "Per-appointment fee off until an admin enables it";

  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px" }}>Activate your account</h3>
      <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "0 0 20px", lineHeight: 1.5 }}>
        Levios uses one global monthly retainer for every client, plus a per-appointment rate set for your business.
        There are no Starter / Growth / Scale plan tiers.
      </p>

      <div
        style={{
          ...S.card,
          marginBottom: 16,
          background: COLORS.surfaceAlt,
        }}
      >
        <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 650 }}>
          Your rates
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: COLORS.orangeLight, marginBottom: 8 }}>
          {monthlyLabel}
        </div>
        <div style={{ fontSize: 13, color: COLORS.textMuted, lineHeight: 1.45 }}>
          {apptLabel}
        </div>
      </div>

      <button
        type="button"
        onClick={startCheckout}
        disabled={busy || billing?.stripeConfigured === false}
        style={{
          ...S.btn("primary"),
          width: "100%",
          minHeight: 44,
          opacity: busy ? 0.7 : 1,
        }}
      >
        {busy ? "Redirecting to Stripe…" : "Activate monthly billing"}
      </button>

      {err && (
        <div role="alert" style={{ marginTop: 14, padding: "9px 13px", borderRadius: 8, background: `${COLORS.red}20`, color: COLORS.red, fontSize: 12 }}>
          {err}
        </div>
      )}

      <p style={{ fontSize: 11, color: COLORS.textDim, marginTop: 16, lineHeight: 1.45 }}>
        Already paid? This page refreshes every few seconds. Locally without Stripe, ask an admin to activate the workspace.
      </p>
      <button
        type="button"
        style={{ ...S.btn("ghost"), marginTop: 12, width: "100%", minHeight: 44 }}
        onClick={() => onSubscribed?.()}
      >
        Continue without checkout (dev)
      </button>
    </div>
  );
}
