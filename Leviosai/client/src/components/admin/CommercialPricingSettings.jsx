import { useEffect, useMemo, useState } from "react";
import { adminApi } from "../../api.js";
import { formatUsd } from "../../lib/billing-receipts.js";
import "../../pages/admin-pricing.css";

function dollarsFromCents(cents) {
  if (cents == null || cents === "") return "";
  const n = Number(cents);
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(n / 100);
}

export function CommercialPricingSettings() {
  const [platform, setPlatform] = useState(null);
  const [clients, setClients] = useState([]);
  const [monthlyFee, setMonthlyFee] = useState("297");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState(null);
  const [charges, setCharges] = useState([]);

  const load = async () => {
    setErr("");
    try {
      const res = await adminApi.getPricingClients();
      const defaults = res.platform || (await adminApi.getCommercialPricing());
      setPlatform(defaults);
      setMonthlyFee(dollarsFromCents(defaults.monthlyFeeCents));
      setClients(Array.isArray(res.clients) ? res.clients : []);
    } catch (e) {
      setErr(e.message || "Failed to load pricing");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const saveGlobals = async () => {
    setBusy("globals");
    setMsg("");
    setErr("");
    try {
      const toCents = (v) => {
        const n = Number(String(v).replace(/[$,\s]/g, ""));
        if (!Number.isFinite(n) || n < 0) throw new Error("Enter a valid dollar amount");
        return Math.round(n * 100);
      };
      await adminApi.saveCommercialPricing({
        monthlyFeeCents: toCents(monthlyFee),
        monthlyFeeEnabledByDefault: true,
      });
      setMsg("Global monthly retainer saved. Existing billed amounts are unchanged.");
      await load();
    } catch (e) {
      setErr(e.message || "Save failed");
    } finally {
      setBusy("");
    }
  };

  const openClient = async (row) => {
    setSelected(row);
    setCharges([]);
    if (row.organization?.id) {
      try {
        const res = await adminApi.getOrgCharges(row.organization.id, 12);
        setCharges(Array.isArray(res?.charges) ? res.charges : []);
      } catch {
        setCharges([]);
      }
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => {
      const hay = [
        c.firstName,
        c.lastName,
        c.email,
        c.role,
        c.organization?.name,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [clients, search]);

  return (
    <div className="pr-page">
      <section className="pr-card" aria-labelledby="pr-global-title">
        <h2 id="pr-global-title">Global monthly retainer</h2>
        <p>
          One monthly amount for every client. Appointment fees are set per user — there is no platform default.
          Changing this amount applies to future months only.
        </p>
        {err && <div className="pr-alert" role="alert">{err}</div>}
        <div className="pr-global-grid pr-global-grid--single">
          <div>
            <label htmlFor="pr-monthly">Global monthly retainer (USD)</label>
            <input
              id="pr-monthly"
              inputMode="decimal"
              autoComplete="off"
              value={monthlyFee}
              onChange={(e) => setMonthlyFee(e.target.value)}
              disabled={!!busy}
            />
          </div>
        </div>
        <div className="pr-actions">
          <button type="button" className="pr-btn pr-btn--primary" onClick={saveGlobals} disabled={!!busy}>
            {busy === "globals" ? "Saving…" : "Save monthly retainer"}
          </button>
          <span className="pr-note">Monthly fee cannot be disabled.</span>
          {msg && <span role="status">{msg}</span>}
        </div>
      </section>

      <section className="pr-card" aria-labelledby="pr-clients-title">
        <div className="pr-clients-head">
          <div>
            <h2 id="pr-clients-title">Clients</h2>
            <p>Open a user to set their appointment fee. There is no global appointment default.</p>
          </div>
          <input
            type="search"
            placeholder="Search name, email, or organization…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search clients"
          />
        </div>

        <div className="pr-table-wrap">
          <table className="pr-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Organization</th>
                <th>Monthly</th>
                <th>Appointment</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.firstName} {c.lastName}</strong>
                    <div className="pr-sub">{c.email}</div>
                    <div className="pr-sub pr-cap">{c.role}</div>
                  </td>
                  <td>
                    {c.organization ? (
                      <>
                        <strong>{c.organization.name}</strong>
                        <div className="pr-sub">
                          {c.organization.workspaceCount || 0} workspace{(c.organization.workspaceCount || 0) === 1 ? "" : "s"}
                        </div>
                      </>
                    ) : (
                      <span className="pr-sub">No organization</span>
                    )}
                  </td>
                  <td>
                    <span className="pr-pill is-on">Always on</span>
                    <div className="pr-amt">{c.pricing ? formatUsd(c.pricing.monthlyFeeCents) : "—"}</div>
                  </td>
                  <td>
                    {c.pricing?.appointmentFeeEnabled ? (
                      <>
                        <span className="pr-pill is-on">On</span>
                        <div className="pr-amt">{formatUsd(c.pricing.appointmentFeeCents)}</div>
                      </>
                    ) : (
                      <span className="pr-pill is-off">Off</span>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="pr-btn pr-btn--ghost"
                      disabled={!c.organization?.id}
                      onClick={() => openClient(c)}
                    >
                      Edit rates
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="pr-empty">No clients match.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selected && (
        <ClientPricingModal
          client={selected}
          platform={platform}
          charges={charges}
          busy={busy === "client"}
          onClose={() => setSelected(null)}
          onSaved={async () => {
            await load();
            const refreshed = (await adminApi.getPricingClients()).clients || [];
            const next = refreshed.find((c) => c.id === selected.id);
            if (next) {
              setSelected(next);
              if (next.organization?.id) {
                const res = await adminApi.getOrgCharges(next.organization.id, 12).catch(() => ({ charges: [] }));
                setCharges(Array.isArray(res?.charges) ? res.charges : []);
              }
            }
          }}
          setBusy={(v) => setBusy(v ? "client" : "")}
        />
      )}
    </div>
  );
}

function ClientPricingModal({ client, platform, charges, busy, onClose, onSaved, setBusy }) {
  const pricing = client.pricing;
  const [apptOn, setApptOn] = useState(!!pricing?.appointmentFeeEnabled);
  const [apptRate, setApptRate] = useState(dollarsFromCents(pricing?.appointmentFeeCents));
  const [useGlobalMonthly, setUseGlobalMonthly] = useState(!!pricing?.monthlyUsesGlobalAmount);
  const [monthlyOverride, setMonthlyOverride] = useState(
    pricing?.monthlyUsesGlobalAmount ? "" : dollarsFromCents(pricing?.monthlyFeeCents)
  );
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setApptOn(!!client.pricing?.appointmentFeeEnabled);
    setApptRate(dollarsFromCents(client.pricing?.appointmentFeeCents));
    setUseGlobalMonthly(!!client.pricing?.monthlyUsesGlobalAmount);
    setMonthlyOverride(
      client.pricing?.monthlyUsesGlobalAmount ? "" : dollarsFromCents(client.pricing?.monthlyFeeCents)
    );
    setErr("");
    setMsg("");
  }, [client, platform]);

  const save = async () => {
    const orgId = client.organization?.id;
    if (!orgId) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const toCents = (v) => {
        const n = Number(String(v).replace(/[$,\s]/g, ""));
        if (!Number.isFinite(n) || n < 0) throw new Error("Enter a valid dollar amount");
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
        if (cents <= 0) throw new Error("Set an appointment fee for this client");
        payload.costPerAppointmentCents = cents;
      }
      await adminApi.saveOrgCommercialPricing(orgId, payload);
      setMsg("Saved. Existing billed amounts were not changed.");
      await onSaved();
    } catch (e) {
      setErr(e.message || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const org = client.organization;
  const joined = client.createdAt ? new Date(client.createdAt).toLocaleDateString() : "—";

  return (
    <div className="pr-modal-root" role="dialog" aria-modal="true" aria-labelledby="pr-modal-title">
      <button type="button" className="pr-modal-backdrop" aria-label="Close" onClick={onClose} />
      <div className="pr-modal">
        <div className="pr-modal-head">
          <h3 id="pr-modal-title">Edit client rates</h3>
          <button type="button" className="pr-btn pr-btn--ghost pr-btn--icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="pr-modal-body">
          <section>
            <p className="pr-label">User details</p>
            <div className="pr-detail-grid">
              <p><span>Name</span> {client.firstName} {client.lastName}</p>
              <p><span>Email</span> {client.email}</p>
              <p><span>Role</span> {client.role}</p>
              <p><span>Joined</span> {joined}</p>
              <p><span>Organization</span> {org?.name || "—"}</p>
              <p><span>Industry</span> {org?.industry || "—"}</p>
              <p><span>Workspaces</span> {(org?.workspaces || []).map((w) => w.name).join(", ") || "—"}</p>
              <p><span>User ID</span> #{client.id}</p>
            </div>
          </section>

          {err && <div className="pr-alert" role="alert">{err}</div>}
          {msg && <p className="pr-ok" role="status">{msg}</p>}

          <section>
            <p className="pr-label">Monthly retainer</p>
            <p className="pr-help">Fixed monthly payment cannot be turned off. Changing the amount only affects future months.</p>
            <label className="pr-check is-locked">
              <input type="checkbox" checked readOnly disabled />
              Monthly retainer is always on
            </label>
            <label className="pr-check">
              <input
                type="checkbox"
                checked={useGlobalMonthly}
                onChange={(e) => setUseGlobalMonthly(e.target.checked)}
                disabled={busy}
              />
              Use global monthly amount ({formatUsd(platform?.monthlyFeeCents)})
            </label>
            {!useGlobalMonthly && (
              <div className="pr-field">
                <label htmlFor="pr-monthly-override">Negotiated monthly (USD)</label>
                <input
                  id="pr-monthly-override"
                  inputMode="decimal"
                  value={monthlyOverride}
                  onChange={(e) => setMonthlyOverride(e.target.value)}
                  disabled={busy}
                />
              </div>
            )}
          </section>

          <section>
            <p className="pr-label">Per appointment</p>
            <p className="pr-help">
              Turning this off stops new booking charges only. Appointments already billed stay charged at their original amount.
            </p>
            <label className="pr-check">
              <input
                type="checkbox"
                checked={apptOn}
                onChange={(e) => setApptOn(e.target.checked)}
                disabled={busy}
              />
              Charge per booked appointment
            </label>
            <div className="pr-field">
              <label htmlFor="pr-appt-rate">Appointment fee (USD)</label>
                <input
                  id="pr-appt-rate"
                  inputMode="decimal"
                  placeholder="Set for this client"
                  value={apptRate}
                  onChange={(e) => setApptRate(e.target.value)}
                  disabled={busy || !apptOn}
                />
            </div>
          </section>

          <section>
            <p className="pr-label">Existing charges (unchanged by this save)</p>
            {charges.length === 0 ? (
              <p className="pr-help">No charges recorded yet.</p>
            ) : (
              <ul className="pr-charge-list">
                {charges.map((c) => (
                  <li key={c.id}>
                    <div>
                      <strong className="pr-cap">{c.feeKind}</strong>
                      <span> · {c.status}</span>
                      <p>{c.description || "—"}</p>
                    </div>
                    <em>{formatUsd(c.amountCents)}</em>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="pr-actions">
            <button type="button" className="pr-btn pr-btn--primary" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save appointment rates"}
            </button>
            <button type="button" className="pr-btn pr-btn--ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
