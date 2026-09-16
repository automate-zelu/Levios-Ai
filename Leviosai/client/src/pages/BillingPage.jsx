import { useEffect, useMemo, useState } from "react";
import { billingApi } from "../api.js";
import { UsageBar } from "../components/billing/UsageBar.jsx";
import {
  billToCsv,
  chargesToCsv,
  currentPeriodKey,
  downloadTextFile,
  formatChargeDate,
  formatUsd,
  openPrintableBill,
  openPrintableCharge,
  openPrintableChargesLedger,
  printOrWarn,
} from "../lib/billing-receipts.js";
import "./billing.css";

const PAGE_SIZE = 20;

const QUICK = [
  { label: "Today", value: "today" },
  { label: "7 Days", value: "week" },
  { label: "30 Days", value: "month" },
  { label: "3 Months", value: "quarter" },
  { label: "1 Year", value: "year" },
  { label: "All Time", value: "all" },
];

const TABS = [
  { key: "all", label: "All" },
  { key: "monthly", label: "Monthly" },
  { key: "appointment", label: "Appointments" },
  { key: "paid", label: "Paid" },
  { key: "pending", label: "Pending" },
];

function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthRange(monthValue) {
  if (!monthValue || !/^\d{4}-\d{2}$/.test(monthValue)) return { startDate: "", endDate: "" };
  const [y, m] = monthValue.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return {
    startDate: `${y}-${String(m).padStart(2, "0")}-01`,
    endDate: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`,
  };
}

function statusClass(status) {
  if (status === "paid") return "is-paid";
  if (status === "waived") return "is-waived";
  if (status === "invoiced") return "is-invoiced";
  return "is-pending";
}

export default function BillingPage() {
  const [data, setData] = useState(null);
  const [bill, setBill] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(currentPeriodKey());
  const [filters, setFilters] = useState(() => ({
    ...monthRange(currentPeriodKey()),
    status: "",
    query: "",
  }));
  const [activeTab, setActiveTab] = useState("all");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const billPeriod = selectedMonth || currentPeriodKey();

  const load = () => {
    setLoading(true);
    setError("");
    const receiptParams = {
      status: filters.status || undefined,
      q: filters.query.trim() || undefined,
      limit: 200,
    };
    if (filters.startDate || filters.endDate) {
      if (filters.startDate) receiptParams.startDate = filters.startDate;
      if (filters.endDate) receiptParams.endDate = filters.endDate;
    } else if (selectedMonth) {
      receiptParams.period = selectedMonth;
    }

    Promise.all([
      billingApi.getStatus(),
      billingApi.getBill(billPeriod).catch(() => null),
      billingApi.getReceipts(receiptParams).catch(() => null),
    ])
      .then(([statusRes, monthBill, receipts]) => {
        setData(statusRes);
        setBill(monthBill);
        setLedger(receipts);
      })
      .catch((e) => setError(e.message || "Failed to load billing"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [selectedMonth, filters.startDate, filters.endDate, filters.status, filters.query]);

  useEffect(() => {
    setPage(1);
  }, [activeTab, filters, selectedMonth]);

  const applyPeriod = (period) => {
    const today = new Date();
    let startDate = "";
    let endDate = toISODate(today);
    switch (period) {
      case "today":
        startDate = toISODate(today);
        break;
      case "week": {
        const d = new Date(today);
        d.setDate(d.getDate() - 7);
        startDate = toISODate(d);
        break;
      }
      case "month": {
        const d = new Date(today);
        d.setMonth(d.getMonth() - 1);
        startDate = toISODate(d);
        break;
      }
      case "quarter": {
        const d = new Date(today);
        d.setMonth(d.getMonth() - 3);
        startDate = toISODate(d);
        break;
      }
      case "year": {
        const d = new Date(today);
        d.setFullYear(d.getFullYear() - 1);
        startDate = toISODate(d);
        break;
      }
      default:
        startDate = "";
        endDate = "";
        break;
    }
    setSelectedMonth("");
    setFilters((p) => ({ ...p, startDate, endDate }));
  };

  const clearAll = () => {
    const month = currentPeriodKey();
    setSelectedMonth(month);
    setFilters({ ...monthRange(month), status: "", query: "" });
    setActiveTab("all");
  };

  const charges = ledger?.charges || [];
  const summary = ledger?.summary || {};

  const displayedRows = useMemo(() => {
    return charges.filter((row) => {
      if (activeTab === "monthly" && row.feeKind !== "monthly") return false;
      if (activeTab === "appointment" && row.feeKind !== "appointment") return false;
      if (activeTab === "paid" && row.status !== "paid") return false;
      if (activeTab === "pending" && !(row.status === "pending" || row.status === "invoiced")) return false;
      return true;
    });
  }, [charges, activeTab]);

  const totalPages = Math.max(1, Math.ceil(displayedRows.length / PAGE_SIZE));
  const pageRows = displayedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openPortal = async () => {
    setBusy("portal");
    try {
      const res = await billingApi.portal(window.location.href);
      if (res.url) window.location.href = res.url;
      else setError("Stripe portal not configured.");
    } catch (e) {
      setError(e.message || "Could not open billing portal");
    } finally {
      setBusy("");
    }
  };

  const cancelAutoRenew = async () => {
    const end = data?.billingCycle?.nextBillingAt || data?.subscription?.currentPeriodEnd;
    const until = end
      ? ` You keep access until ${new Date(end).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })}.`
      : "";
    if (
      !window.confirm(
        `Cancel the monthly retainer? Appointment bookings will still be charged to your card.${until}`
      )
    ) {
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

  const startCheckout = async () => {
    setBusy("checkout");
    setError("");
    try {
      const res = await billingApi.checkout(
        "monthly",
        `${window.location.origin}/billing?success=1`,
        `${window.location.origin}/billing?cancelled=1`
      );
      if (res.url) window.location.href = res.url;
      else setError(res.error || "Checkout unavailable");
    } catch (e) {
      setError(e.message || "Checkout failed");
    } finally {
      setBusy("");
    }
  };

  if (loading && !data) {
    return (
      <div className="loading-state" role="status" aria-live="polite">
        <div className="loading-spinner" aria-hidden="true" />
        <div style={{ fontSize: 14, color: "#a8a8a8" }}>Loading billing…</div>
      </div>
    );
  }

  const commercial = data?.commercialPricing;
  const sdr = data?.sdr;
  const usage = sdr?.usage;
  const sub = data?.subscription;
  const cycle = data?.billingCycle;
  const nextChargeAt = cycle?.nextBillingAt || sub?.currentPeriodEnd;
  const periodEndLabel = nextChargeAt
    ? new Date(nextChargeAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;
  const hasLiveSub = Boolean(sub && (sub.status === "active" || sub.status === "trialing"));
  const workspaceActive = !!sdr?.isActive;

  return (
    <main className="billing-page">
      <header className="billing-page-head">
        <div>
          <h1>Billing &amp; payments</h1>
          <p>Your rates, this month's bill, and a full printable payment history.</p>
        </div>
        <div className="billing-page-actions">
          {!workspaceActive && (
            <button
              type="button"
              className="billing-btn billing-btn--primary"
              onClick={startCheckout}
              disabled={!!busy || !data?.stripeConfigured}
            >
              {busy === "checkout" ? "Opening checkout…" : "Activate monthly billing"}
            </button>
          )}
          <button
            type="button"
            className="billing-btn billing-btn--ghost"
            onClick={openPortal}
            disabled={!!busy || !data?.stripeConfigured}
          >
            {busy === "portal" ? "Opening…" : "Manage payment method"}
          </button>
        </div>
      </header>

      {error && (
        <div className="billing-alert billing-alert--error" role="alert">
          {error}
        </div>
      )}

      <section className="billing-fees" aria-labelledby="billing-fees-title">
        <h2 id="billing-fees-title">Your rates</h2>
        <div className="billing-fee-grid">
          <article className="billing-fee-card">
            <h3>Monthly retainer</h3>
            <p className="billing-fee-amount">
              {commercial?.monthlyFeeEnabled ? `${commercial.monthlyFeeLabel} / mo` : "Off"}
            </p>
            <p className="billing-fee-note">
              {commercial?.monthlyFeeEnabled
                ? commercial.monthlyUsesGlobalAmount
                  ? "Charged automatically to your card on your billing date."
                  : "Custom monthly amount — charged automatically on your billing date."
                : "Monthly fee is off for your account."}
            </p>
          </article>
          <article className="billing-fee-card">
            <h3>Per appointment</h3>
            <p className="billing-fee-amount">
              {commercial?.appointmentFeeEnabled
                ? `${commercial.appointmentFeeLabel} / booking`
                : "Off"}
            </p>
            <p className="billing-fee-note">
              {commercial?.appointmentFeeEnabled
                ? "Charged to your card when the agent books a meeting."
                : "Per-appointment billing is off."}
            </p>
          </article>
          <article className="billing-fee-card">
            <h3>Workspace</h3>
            <p className="billing-fee-amount">
              <span className={`billing-status ${workspaceActive ? "is-on" : "is-off"}`}>
                {workspaceActive ? "Active" : "Inactive"}
              </span>
            </p>
            <p className="billing-fee-note">
              {hasLiveSub
                ? cycle?.canceledAt
                  ? `Canceled · access through ${periodEndLabel || "period end"}`
                  : `Active · next charge ${periodEndLabel || "on your billing date"}`
                : "Activate monthly billing to turn the SDR workspace on."}
            </p>
          </article>
        </div>
      </section>

      <section className="billing-bill" aria-labelledby="billing-bill-title">
        <div className="billing-bill-head">
          <div>
            <h2 id="billing-bill-title">This month&apos;s bill</h2>
            <p>{bill?.periodLabel || billPeriod} — retainer plus appointments.</p>
          </div>
          <div className="billing-bill-tools">
            <button
              type="button"
              className="billing-btn billing-btn--ghost"
              disabled={!bill}
              onClick={() => printOrWarn(openPrintableBill(bill))}
            >
              Print bill
            </button>
            <button
              type="button"
              className="billing-btn billing-btn--ghost"
              disabled={!bill}
              onClick={() => {
                if (!bill) return;
                downloadTextFile(`levios-bill-${bill.period}.csv`, billToCsv(bill), "text/csv;charset=utf-8");
              }}
            >
              Download CSV
            </button>
          </div>
        </div>
        {!bill ? (
          <p className="billing-fee-note">No bill data yet.</p>
        ) : (
          <div className="billing-bill-summary">
            <div>
              <span>Monthly retainer</span>
              <strong>{formatUsd(bill.breakdown?.monthlyCents)}</strong>
            </div>
            <div>
              <span>Appointments ({bill.breakdown?.appointmentCount || 0})</span>
              <strong>{formatUsd(bill.breakdown?.appointmentCents)}</strong>
            </div>
            <div>
              <span>Total</span>
              <strong>{formatUsd(bill.breakdown?.totalCents)}</strong>
            </div>
            <div>
              <span>Paid / pending</span>
              <strong>
                {formatUsd(bill.breakdown?.paidCents)} / {formatUsd(bill.breakdown?.pendingCents)}
              </strong>
            </div>
          </div>
        )}
      </section>

      <section className="billing-ledger" aria-labelledby="billing-ledger-title">
        <div className="billing-bill-head">
          <div>
            <h2 id="billing-ledger-title">Payment history</h2>
            <p>Same filters as admin payment management — month, quick ranges, search, print.</p>
          </div>
          <div className="billing-bill-tools">
            <button
              type="button"
              className="billing-btn billing-btn--ghost"
              disabled={!displayedRows.length}
              onClick={() =>
                printOrWarn(
                  openPrintableChargesLedger(displayedRows, {
                    title: "Your Leviosai payments",
                    subtitle: selectedMonth || `${filters.startDate || "…"} → ${filters.endDate || "…"}`,
                  })
                )
              }
            >
              Print list
            </button>
            <button
              type="button"
              className="billing-btn billing-btn--ghost"
              disabled={!displayedRows.length}
              onClick={() =>
                downloadTextFile(
                  "levios-payments.csv",
                  chargesToCsv(displayedRows, { title: "Payment history" }),
                  "text/csv;charset=utf-8"
                )
              }
            >
              Export CSV
            </button>
          </div>
        </div>

        <div className="billing-pm-filters">
          <div>
            <p className="billing-pm-label">Month</p>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => {
                const v = e.target.value;
                setSelectedMonth(v);
                setFilters((p) => ({ ...p, ...monthRange(v) }));
              }}
            />
          </div>
          <div>
            <p className="billing-pm-label">Quick filters</p>
            <div className="billing-pm-chips">
              {QUICK.map((p) => (
                <button key={p.value} type="button" onClick={() => applyPeriod(p.value)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="billing-pm-label">Custom range</p>
            <div className="billing-pm-range">
              <input
                type="search"
                placeholder="Description or charge ID…"
                value={filters.query}
                onChange={(e) => setFilters((p) => ({ ...p, query: e.target.value }))}
              />
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => {
                  setSelectedMonth("");
                  setFilters((p) => ({ ...p, startDate: e.target.value }));
                }}
              />
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => {
                  setSelectedMonth("");
                  setFilters((p) => ({ ...p, endDate: e.target.value }));
                }}
              />
              <select
                value={filters.status}
                onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}
              >
                <option value="">All statuses</option>
                <option value="paid">Paid</option>
                <option value="pending">Pending</option>
                <option value="invoiced">Invoiced</option>
                <option value="waived">Waived</option>
              </select>
              <button type="button" className="billing-btn billing-btn--ghost" onClick={clearAll}>
                Clear all
              </button>
            </div>
          </div>
        </div>

        <div className="billing-bill-summary billing-ledger-stats">
          <div>
            <span>Transactions</span>
            <strong>{summary.count ?? charges.length}</strong>
          </div>
          <div>
            <span>Total</span>
            <strong>{formatUsd(summary.totalCents)}</strong>
          </div>
          <div>
            <span>Paid</span>
            <strong>{formatUsd(summary.paidCents)}</strong>
          </div>
          <div>
            <span>Pending</span>
            <strong>{formatUsd(summary.pendingCents)}</strong>
          </div>
        </div>

        <div className="billing-pm-panel">
          <div className="billing-pm-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={activeTab === t.key}
                className={activeTab === t.key ? "is-active" : ""}
                onClick={() => setActiveTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="billing-table-wrap">
            <table className="billing-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((c) => (
                  <tr key={c.id} onClick={() => setDetail(c)} className="is-clickable">
                    <td>
                      <div>{formatChargeDate(c.createdAt)}</div>
                      <div className="billing-id">#{c.id}</div>
                    </td>
                    <td className="billing-cap">{c.feeKind}</td>
                    <td>{c.description || "—"}</td>
                    <td>
                      <span className={`billing-pill ${statusClass(c.status)}`}>{c.status}</span>
                    </td>
                    <td className="billing-amt">{formatUsd(c.amountCents)}</td>
                  </tr>
                ))}
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="billing-empty">
                      No payments found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {displayedRows.length > 0 && (
            <div className="billing-pager">
              <button
                type="button"
                className="billing-btn billing-btn--ghost"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ‹
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="billing-btn billing-btn--ghost"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                ›
              </button>
            </div>
          )}
        </div>
      </section>

      {hasLiveSub && (
        <section className="billing-renew" aria-labelledby="billing-renew-title">
          <h2 id="billing-renew-title">Subscription</h2>
          <div className="billing-renew-row">
            <p>
              {sub.autoRenew && !cycle?.canceledAt
                ? `Your card is charged automatically on your billing date${periodEndLabel ? ` (next: ${periodEndLabel})` : ""}. Appointment fees are charged when bookings are made.`
                : `Monthly retainer canceled. Appointment bookings are still charged to your card. Access continues through ${periodEndLabel || "period end"}.`}
            </p>
            {sub.autoRenew && !cycle?.canceledAt ? (
              <button type="button" className="billing-btn billing-btn--ghost" onClick={cancelAutoRenew} disabled={!!busy}>
                {busy === "cancel-renew" ? "Updating…" : "Cancel subscription"}
              </button>
            ) : (
              <button type="button" className="billing-btn billing-btn--primary" onClick={resumeAutoRenew} disabled={!!busy}>
                {busy === "resume-renew" ? "Updating…" : "Resume subscription"}
              </button>
            )}
          </div>
        </section>
      )}

      {usage && <UsageBar usage={usage} />}

      <aside className="billing-help" aria-label="How pricing works">
        <h2>How pricing works</h2>
        <ul>
          <li>Monthly retainer is deducted from your card on your own billing date — the anniversary of when you subscribed.</li>
          <li>Per-appointment fees are deducted from your card when a meeting is booked.</li>
          <li>Cancel the monthly retainer anytime. You keep access until period end. Appointment bookings are still charged to your card.</li>
        </ul>
      </aside>

      {detail && (
        <div className="billing-modal-root" role="dialog" aria-modal="true" aria-labelledby="billing-detail-title">
          <button type="button" className="billing-modal-backdrop" aria-label="Close" onClick={() => setDetail(null)} />
          <div className="billing-modal">
            <div className="billing-modal-head">
              <h3 id="billing-detail-title">Payment details</h3>
              <button type="button" className="billing-btn billing-btn--ghost" onClick={() => setDetail(null)}>
                ×
              </button>
            </div>
            <div className="billing-modal-body">
              <p><strong>Date:</strong> {formatChargeDate(detail.createdAt)}</p>
              <p><strong>Type:</strong> {detail.feeKind}</p>
              <p><strong>Status:</strong> {detail.status}</p>
              <p><strong>Amount:</strong> {formatUsd(detail.amountCents)}</p>
              <p><strong>Description:</strong> {detail.description || "—"}</p>
              <div className="billing-bill-tools" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="billing-btn billing-btn--primary"
                  onClick={() => printOrWarn(openPrintableCharge(detail))}
                >
                  Print receipt
                </button>
                <button
                  type="button"
                  className="billing-btn billing-btn--ghost"
                  onClick={() => printOrWarn(openPrintableBill(bill))}
                  disabled={!bill}
                >
                  Print month bill
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
