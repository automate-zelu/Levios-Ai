import { useEffect, useState } from "react";
import { COLORS, S } from "../../theme.js";
import { billingApi } from "../../api.js";

const POLL_MS = 3000;

/**
 * Step 1 — Subscribe via Stripe Checkout; poll /api/billing until sdr.isActive.
 */
export function OnboardingStep1({ onSubscribed }) {
  const [billing, setBilling] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checkoutPlan, setCheckoutPlan] = useState(null);
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
      const [status, planList] = await Promise.all([
        refresh(),
        billingApi.getPlans().catch(() => ({ plans: [] })),
      ]);
      if (cancelled) return;
      setPlans(Array.isArray(planList) ? planList : planList?.plans || []);
      setLoading(false);
      if (status?.sdr?.isActive) onSubscribed?.();
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (billing?.sdr?.isActive) return undefined;
    const id = setInterval(async () => {
      const status = await refresh();
      if (status?.sdr?.isActive) onSubscribed?.();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [billing?.sdr?.isActive]);

  const startCheckout = async (planKey) => {
    setCheckoutPlan(planKey);
    setErr("");
    try {
      const origin = window.location.origin;
      const res = await billingApi.checkout(
        planKey,
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
      setCheckoutPlan(null);
    }
  };

  if (loading) {
    return <p style={{ color: COLORS.textMuted, fontSize: 14 }}>Checking subscription…</p>;
  }

  if (billing?.sdr?.isActive) {
    return (
      <div style={{ textAlign: "center", padding: "12px 0" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
        <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>Subscription active</h3>
        <p style={{ color: COLORS.textMuted, fontSize: 13, margin: 0 }}>
          Your workspace is live{billing?.sdr?.tier ? ` on the ${billing.sdr.tier} plan` : ""}. Continue to configure your AI SDR.
        </p>
      </div>
    );
  }

  const paidPlans = (Array.isArray(plans) ? plans : []).filter(
    (p) => p.key && ["starter", "growth", "scale", "enterprise"].includes(p.key)
  );
  const planCards = paidPlans.length
    ? paidPlans
    : [
        { key: "starter", name: "Starter", monthlyPriceLabel: "$297 / mo", leadsLimit: 500, minutesLimit: 1000, seatLimit: 2 },
        { key: "growth", name: "Growth", monthlyPriceLabel: "$797 / mo", leadsLimit: 2000, minutesLimit: 4000, seatLimit: 5 },
        { key: "scale", name: "Scale", monthlyPriceLabel: "$1,497 / mo", leadsLimit: 5000, minutesLimit: 10000, seatLimit: 15 },
        { key: "enterprise", name: "Enterprise", monthlyPriceLabel: "$2,497 / mo", leadsLimit: 999999, minutesLimit: 999999, seatLimit: 999999 },
      ];

  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px" }}>Choose a plan</h3>
      <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "0 0 20px", lineHeight: 1.5 }}>
        Flat monthly subscription. Subscribe to activate your workspace — we&apos;ll detect payment when you return from Stripe.
      </p>
      <div style={{ display: "grid", gap: 12 }}>
        {planCards.map((p) => {
          const key = p.key || p.id || p.name?.toLowerCase();
          const busy = checkoutPlan === key;
          const limitLine =
            p.leadsLimit != null
              ? `${p.leadsLimit >= 999999 ? "Unlimited" : Number(p.leadsLimit).toLocaleString()} leads · ${
                  p.minutesLimit >= 999999 ? "Unlimited" : Number(p.minutesLimit ?? 0).toLocaleString()
                } min / mo`
              : "";
          const priceLabel = p.monthlyPriceLabel || p.priceHint || limitLine;
          return (
            <button
              key={key}
              type="button"
              onClick={() => startCheckout(key)}
              disabled={!!checkoutPlan || p.purchasable === false}
              style={{
                ...S.card,
                marginBottom: 0,
                textAlign: "left",
                cursor: checkoutPlan ? "wait" : "pointer",
                opacity: busy ? 0.7 : 1,
                border: `1px solid ${COLORS.border}`,
                background: COLORS.surfaceAlt,
                color: COLORS.text,
                fontFamily: "inherit",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{p.name || key}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: COLORS.orangeLight, marginTop: 4 }}>{priceLabel}</div>
                  {limitLine && (
                    <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 4 }}>{limitLine}</div>
                  )}
                </div>
                <span style={{ ...S.btn("primary"), padding: "8px 14px", pointerEvents: "none", flexShrink: 0 }}>
                  {busy ? "Redirecting…" : "Subscribe"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {err && (
        <div style={{ marginTop: 14, padding: "9px 13px", borderRadius: 8, background: `${COLORS.red}20`, color: COLORS.red, fontSize: 12 }}>
          {err}
        </div>
      )}
      <p style={{ fontSize: 11, color: COLORS.textDim, marginTop: 16 }}>
        Already paid? This page refreshes every few seconds. In local/dev without Stripe, ask an admin to activate the workspace.
      </p>
      <button
        type="button"
        style={{ ...S.btn("ghost"), marginTop: 12, width: "100%" }}
        onClick={() => onSubscribed?.()}
      >
        Continue without checkout (dev)
      </button>
    </div>
  );
}
