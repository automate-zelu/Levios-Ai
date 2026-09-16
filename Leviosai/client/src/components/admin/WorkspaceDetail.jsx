import { useEffect, useState } from "react";
import { COLORS, S, formatDuration } from "../../theme.js";
import { adminApi } from "../../api.js";

function TwilioTab({ workspaceId }) {
  const [status, setStatus] = useState(null);
  const [areaCode, setAreaCode] = useState("415");
  const [numbers, setNumbers] = useState([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      setStatus(await adminApi.getTwilioStatus(workspaceId));
    } catch (e) {
      setErr(e.message);
    }
  };

  useEffect(() => {
    load();
  }, [workspaceId]);

  const provision = async () => {
    setBusy("provision");
    setErr("");
    try {
      await adminApi.provisionTwilio(workspaceId);
      await load();
    } catch (e) {
      setErr(e.message || "Provision failed");
    } finally {
      setBusy("");
    }
  };

  const search = async () => {
    setBusy("search");
    setErr("");
    try {
      const res = await adminApi.searchNumbers(workspaceId, areaCode, 8);
      setNumbers(Array.isArray(res) ? res : []);
    } catch (e) {
      setErr(e.message || "Search failed");
    } finally {
      setBusy("");
    }
  };

  const assign = async (phoneNumber) => {
    setBusy(phoneNumber);
    setErr("");
    try {
      await adminApi.assignNumber(workspaceId, phoneNumber);
      setNumbers([]);
      await load();
    } catch (e) {
      setErr(e.message || "Assign failed");
    } finally {
      setBusy("");
    }
  };

  const release = async () => {
    if (!confirm("Release Twilio for this workspace?")) return;
    setBusy("release");
    try {
      await adminApi.releaseTwilio(workspaceId, false);
      await load();
    } catch (e) {
      setErr(e.message || "Release failed");
    } finally {
      setBusy("");
    }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <span style={S.badge(status?.provisioned ? COLORS.green : COLORS.red)}>
          {status?.provisioned ? "Active" : status?.hasSubAccount ? "No Number" : "Not Provisioned"}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 4 }}>Phone Number</div>
          <div style={{ fontWeight: 600 }}>{status?.phoneNumber || "—"}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 4 }}>Sub-Account SID</div>
          <div style={{ fontWeight: 600, fontFamily: "monospace", fontSize: 12 }}>
            {status?.subAccountSidMasked || "—"}
          </div>
        </div>
      </div>

      {err && (
        <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: `${COLORS.red}20`, color: COLORS.red, fontSize: 12 }}>
          {err}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        {!status?.hasSubAccount && (
          <button style={{ ...S.btn("primary"), opacity: busy === "provision" ? 0.7 : 1 }} onClick={provision} disabled={!!busy}>
            {busy === "provision" ? "Provisioning…" : "Create Sub-Account"}
          </button>
        )}
        {status?.hasSubAccount && !status?.provisioned && (
          <>
            <input
              style={{ ...S.input, width: 100 }}
              value={areaCode}
              onChange={(e) => setAreaCode(e.target.value)}
              placeholder="Area code"
            />
            <button style={S.btn("secondary")} onClick={search} disabled={!!busy}>
              {busy === "search" ? "Searching…" : "Search Numbers"}
            </button>
          </>
        )}
        {status?.hasSubAccount && (
          <button style={S.btn("danger")} onClick={release} disabled={!!busy}>
            Release
          </button>
        )}
      </div>

      {numbers.length > 0 && (
        <div style={{ display: "grid", gap: 8 }}>
          {numbers.map((n) => (
            <div
              key={n.phoneNumber}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 12px",
                background: COLORS.surfaceAlt,
                borderRadius: 8,
                border: `1px solid ${COLORS.border}`,
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{n.phoneNumber}</div>
                <div style={{ fontSize: 11, color: COLORS.textMuted }}>
                  {n.locality} {n.region}
                </div>
              </div>
              <button
                style={{ ...S.btn("primary"), padding: "6px 12px", fontSize: 12 }}
                onClick={() => assign(n.phoneNumber)}
                disabled={!!busy}
              >
                Assign
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Per-workspace management: activate, commercial rates, Twilio, enrollments.
 */
export function WorkspaceDetail({ workspaceId, onBack, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [enrollments, setEnrollments] = useState([]);
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [monthlyOn, setMonthlyOn] = useState(true);
  const [monthlyOverride, setMonthlyOverride] = useState("");
  const [useGlobalMonthly, setUseGlobalMonthly] = useState(true);
  const [apptOn, setApptOn] = useState(true);
  const [apptRate, setApptRate] = useState("");
  const [pricingMsg, setPricingMsg] = useState("");

  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      const [d, e] = await Promise.all([
        adminApi.getWorkspace(workspaceId),
        adminApi.getWorkspaceEnrollments(workspaceId, { limit: 20 }),
      ]);
      setDetail(d);
      setEnrollments(e?.data || []);
      const cp = d?.commercialPricing;
      const pd = d?.platformDefaults;
      if (cp) {
        setMonthlyOn(true);
        setApptOn(!!cp.appointmentFeeEnabled);
        setUseGlobalMonthly(!!cp.monthlyUsesGlobalAmount);
        setMonthlyOverride(
          cp.monthlyUsesGlobalAmount
            ? ""
            : String((cp.monthlyFeeCents || 0) / 100)
        );
        setApptRate(cp.appointmentFeeCents ? String(cp.appointmentFeeCents / 100) : "");
      } else if (pd) {
        setMonthlyOn(true);
        setApptOn(false);
        setApptRate("");
      }
    } catch (e) {
      setErr(e.message || "Failed to load workspace");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [workspaceId]);

  const ws = detail?.workspace;

  const toggle = async () => {
    setBusy(true);
    try {
      await adminApi.setWorkspaceStatus(workspaceId, !ws.isActive);
      await load();
      onChanged?.();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!confirm("Reset monthly usage to 0?")) return;
    setBusy(true);
    try {
      await adminApi.resetUsage(workspaceId);
      await load();
      onChanged?.();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const saveCommercial = async () => {
    const orgId = detail?.organization?.id;
    if (!orgId) {
      alert("This workspace has no organization linked.");
      return;
    }
    setBusy(true);
    setPricingMsg("");
    try {
      const toCents = (v) => {
        const n = Number(String(v).replace(/[$,\s]/g, ""));
        if (!Number.isFinite(n) || n < 0) return null;
        return Math.round(n * 100);
      };
      const payload = {
        monthlyFeeEnabled: true,
        clearMonthlyOverride: useGlobalMonthly,
        monthlyFeeOverrideCents: useGlobalMonthly ? null : toCents(monthlyOverride),
        appointmentFeeEnabled: apptOn,
      };
      if (apptOn) {
        const cents = toCents(apptRate);
        if (cents == null || cents <= 0) throw new Error("Set an appointment fee for this client");
        payload.costPerAppointmentCents = cents;
      }
      await adminApi.saveOrgCommercialPricing(orgId, payload);
      setPricingMsg("Commercial rates saved.");
      await load();
      onChanged?.();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div style={{ color: COLORS.textMuted, padding: 40, textAlign: "center" }}>Loading workspace…</div>;
  }

  if (err || !ws) {
    return (
      <div>
        <button style={S.btn("ghost")} onClick={onBack}>← Back</button>
        <div style={{ color: COLORS.red, marginTop: 16 }}>{err || "Not found"}</div>
      </div>
    );
  }

  return (
    <div>
      <button style={{ ...S.btn("ghost"), marginBottom: 16 }} onClick={onBack}>← Back to workspaces</button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 16, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{ws.name}</h2>
          <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "monospace", marginTop: 4 }}>{ws.id}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span style={S.badge(ws.isActive ? COLORS.green : COLORS.red)}>{ws.isActive ? "Active" : "Inactive"}</span>
        </div>
      </div>

      <div role="tablist" aria-label="Workspace sections" style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {[
          { id: "overview", label: "Overview" },
          { id: "enrollments", label: "Enrollments" },
          { id: "twilio", label: "Twilio" },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            style={{
              ...S.tab(tab === t.id),
              cursor: "pointer",
              border: "none",
              fontFamily: "inherit",
              minHeight: 40,
            }}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={S.card}>
            <div style={S.cardHeader}>Account</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 14, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: COLORS.textMuted }}>Monthly fee</div>
                <div style={{ fontWeight: 600 }}>
                  {detail.commercialPricing?.monthlyFeeEnabled
                    ? `$${(detail.commercialPricing.monthlyFeeCents / 100).toLocaleString("en-US")}`
                    : "Off"}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: COLORS.textMuted }}>Per appointment</div>
                <div style={{ fontWeight: 600 }}>
                  {detail.commercialPricing?.appointmentFeeEnabled
                    ? `$${(detail.commercialPricing.appointmentFeeCents / 100).toLocaleString("en-US")}`
                    : "Off"}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: COLORS.textMuted }}>Leads enrolled this period</div>
                <div style={{ fontWeight: 600 }}>{ws.monthlyLeadsUsed ?? 0}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: COLORS.textMuted }}>Call time this period</div>
                <div style={{ fontWeight: 600 }}>
                  {formatDuration(Math.round(Number(ws.monthlyMinutesUsed || 0) * 60))}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button type="button" style={{ ...S.btn(ws.isActive ? "danger" : "success"), minHeight: 40 }} onClick={toggle} disabled={busy}>
                {ws.isActive ? "Deactivate" : "Activate"}
              </button>
              <button type="button" style={{ ...S.btn("ghost"), minHeight: 40 }} onClick={reset} disabled={busy}>
                Reset period usage
              </button>
            </div>
          </div>

          <section style={S.card} aria-labelledby="commercial-pricing-title">
            <h3 id="commercial-pricing-title" style={{ ...S.cardHeader, display: "block", margin: "0 0 8px" }}>
              Commercial pricing
            </h3>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: COLORS.textMuted, lineHeight: 1.45 }}>
              Monthly retainer is always on. Appointment fee can be turned off for new bookings only — existing charges keep their amount.
            </p>
            <div style={{ display: "grid", gap: 14 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, minHeight: 40, color: COLORS.textMuted }}>
                <input type="checkbox" checked readOnly disabled style={{ width: 18, height: 18 }} />
                Monthly retainer is always on (cannot disable)
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, minHeight: 40 }}>
                <input
                  type="checkbox"
                  checked={useGlobalMonthly}
                  onChange={(e) => setUseGlobalMonthly(e.target.checked)}
                  disabled={busy}
                  style={{ width: 18, height: 18 }}
                />
                Use global monthly amount
                {detail.platformDefaults && (
                  <span style={{ color: COLORS.textMuted }}>
                    (${((detail.platformDefaults.monthlyFeeCents || 0) / 100).toLocaleString("en-US")}/mo)
                  </span>
                )}
              </label>
              {!useGlobalMonthly && (
                <div>
                  <label htmlFor={`monthly-override-${workspaceId}`} style={{ display: "block", fontSize: 12, color: COLORS.textMuted, marginBottom: 6, fontWeight: 600 }}>
                    Negotiated monthly fee (USD)
                  </label>
                  <input
                    id={`monthly-override-${workspaceId}`}
                    inputMode="decimal"
                    style={{ ...S.input, maxWidth: 200, minHeight: 44 }}
                    value={monthlyOverride}
                    onChange={(e) => setMonthlyOverride(e.target.value)}
                    placeholder="297"
                    disabled={busy}
                  />
                </div>
              )}
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, minHeight: 40 }}>
                <input type="checkbox" checked={apptOn} onChange={(e) => setApptOn(e.target.checked)} style={{ width: 18, height: 18 }} />
                Charge per appointment / job (new bookings only)
              </label>
              <div>
                <label htmlFor={`appt-rate-${workspaceId}`} style={{ display: "block", fontSize: 12, color: COLORS.textMuted, marginBottom: 6, fontWeight: 600 }}>
                  Per-appointment rate (USD)
                </label>
                <input
                  id={`appt-rate-${workspaceId}`}
                  inputMode="decimal"
                  style={{ ...S.input, maxWidth: 200, minHeight: 44 }}
                  value={apptRate}
                  onChange={(e) => setApptRate(e.target.value)}
                  placeholder="400"
                  disabled={!apptOn || busy}
                />
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button type="button" style={{ ...S.btn("primary"), minHeight: 44 }} onClick={saveCommercial} disabled={busy || !detail.organization?.id}>
                  Save commercial rates
                </button>
                <span role="status" aria-live="polite" style={{ fontSize: 12, color: COLORS.green }}>{pricingMsg}</span>
              </div>
              {(detail.recentCharges || []).length > 0 && (
                <div>
                  <h4 style={{ fontSize: 13, fontWeight: 600, margin: "4px 0 8px" }}>Recent booking charges</h4>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
                    {detail.recentCharges.slice(0, 5).map((c) => (
                      <li
                        key={c.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 8,
                          fontSize: 12,
                          padding: "8px 10px",
                          borderRadius: 8,
                          background: COLORS.surfaceAlt,
                          border: `1px solid ${COLORS.border}`,
                        }}
                      >
                        <span>
                          {c.feeKind} · {c.status}
                          {c.description ? ` — ${c.description}` : ""}
                        </span>
                        <strong>${((c.amountCents || 0) / 100).toFixed(2)}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>

          <div style={S.card}>
            <div style={S.cardHeader}>SDR config</div>
            {detail.sdrConfig ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 12, fontSize: 13 }}>
                <div>Active: <strong>{detail.sdrConfig.isActive ? "Yes" : "No"}</strong></div>
                <div>Dormant: <strong>{detail.sdrConfig.dormantDays}d</strong></div>
                <div>Wait call: <strong>{detail.sdrConfig.waitCallHrs}h</strong></div>
                <div>Wait SMS: <strong>{detail.sdrConfig.waitSmsHrs}h</strong></div>
                <div>Re-enroll: <strong>{detail.sdrConfig.reEnrollDays}d</strong></div>
                <div>Assistant: <strong>{detail.sdrConfig.assistantName || "—"}</strong></div>
              </div>
            ) : (
              <div style={{ color: COLORS.textMuted, fontSize: 13 }}>No SDR config yet.</div>
            )}
          </div>
        </div>
      )}

      {tab === "enrollments" && (
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
          <table style={S.table}>
            <thead>
              <tr style={{ background: COLORS.surfaceAlt }}>
                <th style={S.th}>ID</th>
                <th style={S.th}>Status</th>
                <th style={S.th}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {enrollments.map((e) => (
                <tr key={e.id}>
                  <td style={S.td}><span style={{ fontFamily: "monospace", fontSize: 11 }}>{String(e.id).slice(0, 12)}…</span></td>
                  <td style={S.td}><span style={S.badge(COLORS.blue)}>{e.status}</span></td>
                  <td style={S.td}>{e.updatedAt ? new Date(e.updatedAt).toLocaleString() : "—"}</td>
                </tr>
              ))}
              {enrollments.length === 0 && (
                <tr><td colSpan={3} style={{ ...S.td, textAlign: "center", color: COLORS.textMuted, padding: 32 }}>No enrollments</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "twilio" && (
        <div style={S.card}>
          <div style={S.cardHeader}>Twilio Provisioning</div>
          <TwilioTab workspaceId={workspaceId} />
        </div>
      )}
    </div>
  );
}
