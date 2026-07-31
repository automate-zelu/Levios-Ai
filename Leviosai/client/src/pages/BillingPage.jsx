import { useEffect, useState } from "react";
import { COLORS, S } from "../theme.js";
import { billingApi } from "../api.js";
import { TierBadge } from "../components/billing/TierBadge.jsx";
import { UsageBar } from "../components/billing/UsageBar.jsx";
import { UpgradePrompt } from "../components/billing/UpgradePrompt.jsx";

const PLAN_ORDER = ["starter", "growth", "scale", "enterprise"];

function planRank(key) {
  const i = PLAN_ORDER.indexOf(key === "pro" ? "growth" : key === "free" ? "starter" : key);
  return i < 0 ? 0 : i;
}

function formatLimit(n) {
  if (n == null || n < 0 || n >= 999_999) return "Unlimited";
  return Number(n).toLocaleString();
}

export default function BillingPage() {
  const [data, setData] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    Promise.all([billingApi.getStatus(), billingApi.getPlans().catch(() => [])])
      .then(([status, planList]) => {
        setData(status);
        setPlans(Array.isArray(planList) ? planList : []);
      })
      .catch((e) => setError(e.message || "Failed to load billing"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openPortal = async () => {
    setBusy("portal");
    try {
      const res = await billingApi.portal(window.location.href);
      if (res.url) window.location.href = res.url;
      else setError("Stripe portal not configured. Set STRIPE_SECRET_KEY.");
    } catch (e) {
      setError(e.message || "Could not open Stripe portal");
    } finally {
      setBusy("");
    }
  };

  const cancelAutoRenew = async () => {
    if (!window.confirm("Turn off auto-renew? You’ll keep access until the end of this billing period, then the plan ends.")) {
      return;
    }
    setBusy("cancel-renew");
    setError("");
    try {
      await billingApi.cancelRenewal();
      load();
    } catch (e) {
      setError(e.message || "Could not cancel auto-renew");
    } finally {
      setBusy("");
    }
  };

  const resumeAutoRenew = async () => {
    setBusy("resume-renew");
    setError("");
    try {
      await billingApi.resumeRenewal();
      load();
    } catch (e) {
      setError(e.message || "Could not resume auto-renew");
    } finally {
      setBusy("");
    }
  };

  const startCheckout = async (planKey) => {
    setBusy(planKey);
    try {
      const res = await billingApi.checkout(
        planKey,
        `${window.location.origin}/billing?success=1`,
        `${window.location.origin}/billing?cancelled=1`
      );
      if (res.url) window.location.href = res.url;
      else setError(res.error || "Checkout unavailable for this plan");
    } catch (e) {
      setError(e.message || "Checkout failed");
    } finally {
      setBusy("");
    }
  };

  if (loading) {
    return (
      <div className="loading-state">
        <div className="loading-spinner" />
        <div style={{ fontSize: 14, color: COLORS.textMuted }}>Loading billing…</div>
      </div>
    );
  }

  const sdr = data?.sdr;
  const usage = sdr?.usage;
  const currentPlan = data?.plan || "free";
  const checkoutPlans = plans.filter((p) => PLAN_ORDER.includes(p.key));
  const sub = data?.subscription;
  const periodEndLabel = sub?.currentPeriodEnd
    ? new Date(sub.currentPeriodEnd).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;
  const hasLiveSub = Boolean(sub && (sub.status === "active" || sub.status === "trialing"));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Billing & Subscription</h2>
          <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "4px 0 0" }}>
            Flat monthly SDR plans — Starter through Enterprise
          </p>
        </div>
        <button
          type="button"
          style={{ ...S.btn("secondary"), opacity: busy === "portal" ? 0.6 : 1 }}
          onClick={openPortal}
          disabled={!!busy || !data?.stripeConfigured}
        >
          {busy === "portal" ? "Opening…" : "Manage in Stripe"}
        </button>
      </div>

      {error && (
        <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 8, background: `${COLORS.red}18`, border: `1px solid ${COLORS.red}44`, color: COLORS.red, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={S.card}>
        <div style={S.cardHeader}>
          <span>Current plan</span>
          <TierBadge tier={sdr?.tier || currentPlan} active={sdr?.isActive} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: COLORS.textMuted }}>Org plan</div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{data?.planDetails?.name || currentPlan}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: COLORS.textMuted }}>SDR tier</div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{sdr?.tierLabel || "—"}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: COLORS.textMuted }}>Price</div>
            <div style={{ fontWeight: 600 }}>
              {data?.planDetails?.monthlyPriceLabel || sdr?.priceHint || "—"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: COLORS.textMuted }}>Stripe</div>
            <div style={{ fontWeight: 600 }}>
              {data?.stripeConfigured ? (sub?.status || "Connected") : "Not configured"}
            </div>
          </div>
          {hasLiveSub && (
            <>
              <div>
                <div style={{ fontSize: 11, color: COLORS.textMuted }}>Auto-renew</div>
                <div style={{ fontWeight: 600, color: sub.autoRenew ? COLORS.green : COLORS.yellow }}>
                  {sub.autoRenew ? "On" : "Off"}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: COLORS.textMuted }}>
                  {sub.cancelAtPeriodEnd ? "Ends on" : "Renews on"}
                </div>
                <div style={{ fontWeight: 600 }}>{periodEndLabel || "—"}</div>
              </div>
            </>
          )}
        </div>

        {hasLiveSub && (
          <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            {sub.autoRenew ? (
              <button
                type="button"
                style={{ ...S.btn("secondary"), opacity: busy === "cancel-renew" ? 0.6 : 1 }}
                onClick={cancelAutoRenew}
                disabled={!!busy}
              >
                {busy === "cancel-renew" ? "Updating…" : "Cancel auto-renew"}
              </button>
            ) : (
              <button
                type="button"
                style={{ ...S.btn("primary"), opacity: busy === "resume-renew" ? 0.6 : 1 }}
                onClick={resumeAutoRenew}
                disabled={!!busy}
              >
                {busy === "resume-renew" ? "Updating…" : "Resume auto-renew"}
              </button>
            )}
            <span style={{ fontSize: 12, color: COLORS.textMuted, maxWidth: 420, lineHeight: 1.45 }}>
              {sub.autoRenew
                ? "Your plan renews monthly. Cancel anytime — you keep access until the period ends."
                : `Auto-renew is off. Access continues through ${periodEndLabel || "period end"}.`}
            </span>
          </div>
        )}
      </div>

      {usage && (
        <>
          <UsageBar
            usage={{
              ...usage,
              leadsLimit: usage.leadsUnlimited ? 0 : usage.leadsLimit,
              minutesLimit: usage.minutesUnlimited ? 0 : usage.minutesLimit,
            }}
          />
          <UpgradePrompt usage={usage} onUpgrade={() => {
            const el = document.getElementById("billing-plans");
            el?.scrollIntoView({ behavior: "smooth" });
          }} />
        </>
      )}

      <div id="billing-plans" style={S.card}>
        <div style={S.cardHeader}>Available plans</div>
        <p style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 0, marginBottom: 14 }}>
          Prices follow the implementation plan catalog (default list price = low end of each suggested band).
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
          {checkoutPlans.map((plan) => {
            const isCurrent = planRank(plan.key) === planRank(currentPlan) ||
              (sdr?.tier && plan.key === sdr.tier);
            const isUpgrade = planRank(plan.key) > planRank(currentPlan === "pro" ? "growth" : currentPlan);
            return (
              <div
                key={plan.key}
                style={{
                  border: `1px solid ${isCurrent ? COLORS.orange : COLORS.border}`,
                  borderRadius: 12,
                  padding: 16,
                  background: isCurrent ? COLORS.orangeGlow : COLORS.surfaceAlt,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{plan.name}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: COLORS.orangeLight, marginBottom: 4 }}>
                  {plan.monthlyPriceLabel || plan.priceHint}
                </div>
                {plan.suggestedMinUsd != null && plan.suggestedMaxUsd != null && (
                  <div style={{ fontSize: 11, color: COLORS.textDim, marginBottom: 10 }}>
                    Suggested band ${plan.suggestedMinUsd.toLocaleString()}–${plan.suggestedMaxUsd.toLocaleString()} / mo
                  </div>
                )}
                <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 8, lineHeight: 1.5 }}>
                  {formatLimit(plan.leadsLimit)} leads · {formatLimit(plan.minutesLimit)} min · {formatLimit(plan.seatLimit)} seats
                </div>
                {Array.isArray(plan.features) && (
                  <ul style={{ margin: "0 0 14px", paddingLeft: 18, fontSize: 11, color: COLORS.textMuted, lineHeight: 1.6 }}>
                    {plan.features.slice(0, 3).map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                )}
                {isCurrent ? (
                  <span style={S.badge(COLORS.green)}>Current plan</span>
                ) : (
                  <button
                    type="button"
                    style={{ ...S.btn(isUpgrade ? "primary" : "secondary"), padding: "8px 14px", fontSize: 12, width: "100%" }}
                    disabled={!!busy || !data?.stripeConfigured || !plan.purchasable}
                    onClick={() => startCheckout(plan.key)}
                    title={!plan.purchasable ? "Run npm run stripe:sync-prices after setting STRIPE_SECRET_KEY" : undefined}
                  >
                    {busy === plan.key ? "Redirecting…" : isUpgrade ? "Upgrade" : "Switch"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {!data?.stripeConfigured && (
          <div style={{ marginTop: 14, fontSize: 12, color: COLORS.textMuted }}>
            Stripe is not configured. Set <code>STRIPE_SECRET_KEY</code>, then run <code>npm run stripe:sync-prices</code> to create plan prices.
          </div>
        )}
        {data?.stripeConfigured && checkoutPlans.some((p) => !p.purchasable) && (
          <div style={{ marginTop: 14, fontSize: 12, color: COLORS.yellow }}>
            Some plans are missing Stripe Price IDs. Run <code>npm run stripe:sync-prices</code> and paste the printed IDs into <code>.env</code>.
          </div>
        )}
      </div>
    </div>
  );
}
