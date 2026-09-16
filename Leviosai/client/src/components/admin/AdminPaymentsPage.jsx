import { useEffect, useMemo, useState } from "react";
import { adminApi } from "../../api.js";
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
} from "../../lib/billing-receipts.js";
import "../../pages/admin-payments.css";

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
  { key: "monthly", label: "Monthly retainer" },
  { key: "appointment", label: "Appointments" },
  { key: "paid", label: "Received" },
  { key: "pending", label: "Outstanding" },
];

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

function StatusBadge({ status }) {
  return <span className={`pm-badge ${statusClass(status)}`}>{status || "—"}</span>;
}

function StatCard({ label, value, accent }) {
  return (
    <div className="pm-stat">
      <div className={`pm-stat-icon ${accent}`} aria-hidden="true" />
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

export function AdminPaymentsPage() {
  const [selectedMonth, setSelectedMonth] = useState(currentPeriodKey());
  const [filters, setFilters] = useState(() => ({
    ...monthRange(currentPeriodKey()),
    status: "",
    query: "",
  }));
  const [activeTab, setActiveTab] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [detail, setDetail] = useState(null);
  const [bill, setBill] = useState(null);

  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      const params = {
        limit: 500,
        q: filters.query.trim() || undefined,
        status: filters.status || undefined,
      };
      if (filters.startDate || filters.endDate) {
        if (filters.startDate) params.startDate = filters.startDate;
        if (filters.endDate) params.endDate = filters.endDate;
      } else if (selectedMonth) {
        params.period = selectedMonth;
      }
      const res = await adminApi.getPayments(params);
      setData(res);
    } catch (e) {
      setErr(e.message || "Failed to load payments");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [filters.startDate, filters.endDate, filters.status, filters.query, selectedMonth]);

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

  const charges = data?.charges || [];
  const summary = data?.summary || {};

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

  const openDetail = async (row) => {
    setDetail(row);
    setBill(null);
    if (!row?.organizationId) return;
    try {
      const period =
        selectedMonth ||
        (row.createdAt
          ? `${new Date(row.createdAt).getFullYear()}-${String(new Date(row.createdAt).getMonth() + 1).padStart(2, "0")}`
          : currentPeriodKey());
      const b = await adminApi.getOrgBill(row.organizationId, period);
      setBill(b);
    } catch {
      /* bill optional in modal */
    }
  };

  const closeDetail = () => {
    setDetail(null);
    setBill(null);
  };

  const setChargeStatus = async (id, next) => {
    setBusy(`pay-${id}`);
    try {
      await adminApi.setPaymentStatus(id, next);
      await load();
      if (detail?.id === id) {
        setDetail((d) => (d ? { ...d, status: next } : d));
      }
      if (detail?.organizationId) {
        const period = selectedMonth || currentPeriodKey();
        const b = await adminApi.getOrgBill(detail.organizationId, period).catch(() => null);
        setBill(b);
      }
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy("");
    }
  };

  const printLedger = () => {
    printOrWarn(
      openPrintableChargesLedger(displayedRows, {
        title: "Leviosai payment ledger",
        subtitle: selectedMonth || `${filters.startDate || "…"} → ${filters.endDate || "…"}`,
      })
    );
  };

  const downloadLedger = () => {
    downloadTextFile(
      `levios-payments.csv`,
      chargesToCsv(displayedRows, { title: "Payment Management" }),
      "text/csv;charset=utf-8"
    );
  };

  return (
    <div className="pm-page">
      <div className="pm-head">
        <div>
          <h2>Payment Management</h2>
          <p>Track retainers and appointment fees received from clients — filter, inspect, print.</p>
        </div>
        <div className="pm-head-actions">
          <button type="button" className="pm-btn pm-btn--ghost" onClick={printLedger} disabled={!displayedRows.length}>
            Print
          </button>
          <button type="button" className="pm-btn pm-btn--primary" onClick={downloadLedger} disabled={!displayedRows.length}>
            Export CSV
          </button>
        </div>
      </div>

      <div className="pm-stats">
        <StatCard label="Transactions" value={summary.count ?? "—"} accent="is-copper" />
        <StatCard label="Total billed" value={formatUsd(summary.totalCents)} accent="is-blue" />
        <StatCard label="Received" value={formatUsd(summary.paidCents)} accent="is-green" />
        <StatCard label="Outstanding" value={formatUsd(summary.pendingCents)} accent="is-amber" />
      </div>

      <div className="pm-filters">
        <div>
          <p className="pm-label">Month</p>
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

        <div className="pm-divider" />

        <div>
          <p className="pm-label">Quick filters</p>
          <div className="pm-chips">
            {QUICK.map((p) => (
              <button key={p.value} type="button" className="pm-chip" onClick={() => applyPeriod(p.value)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pm-divider" />

        <div>
          <p className="pm-label">Custom range</p>
          <div className="pm-range-row">
            <input
              type="search"
              placeholder="Client, description, charge ID…"
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
            <button type="button" className="pm-btn pm-btn--ghost" onClick={clearAll}>
              Clear all
            </button>
          </div>
        </div>
      </div>

      {err && <div className="pm-alert" role="alert">{err}</div>}

      <div className="pm-table-panel">
        <div className="pm-tabs" role="tablist" aria-label="Payment types">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={activeTab === t.key}
              className={`pm-tab${activeTab === t.key ? " is-active" : ""}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="pm-empty">Loading payments…</div>
        ) : displayedRows.length === 0 ? (
          <div className="pm-empty">No payments found.</div>
        ) : (
          <>
            <div className="pm-table-wrap">
              <table className="pm-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Client</th>
                    <th>Type</th>
                    <th>Description</th>
                    <th className="is-right">Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => (
                    <tr key={row.id} onClick={() => openDetail(row)}>
                      <td className="pm-date">{formatChargeDate(row.createdAt)}</td>
                      <td>
                        <div className="pm-client">{row.organizationName || `Org ${row.organizationId}`}</div>
                        <div className="pm-sub">#{row.id}</div>
                      </td>
                      <td className="pm-cap">{row.feeKind}</td>
                      <td className="pm-desc">{row.description || "—"}</td>
                      <td className="is-right pm-amt">{formatUsd(row.amountCents)}</td>
                      <td><StatusBadge status={row.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pm-pager">
              <button
                type="button"
                className="pm-btn pm-btn--ghost pm-btn--icon"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
              >
                ‹
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="pm-btn pm-btn--ghost pm-btn--icon"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Next page"
              >
                ›
              </button>
            </div>
          </>
        )}
      </div>

      {detail && (
        <div className="pm-modal-root" role="dialog" aria-modal="true" aria-labelledby="pm-detail-title">
          <button type="button" className="pm-modal-backdrop" aria-label="Close" onClick={closeDetail} />
          <div className="pm-modal">
            <div className="pm-modal-head">
              <h3 id="pm-detail-title">Payment details</h3>
              <button type="button" className="pm-btn pm-btn--ghost pm-btn--icon" onClick={closeDetail} aria-label="Close">
                ×
              </button>
            </div>
            <div className="pm-modal-body">
              <section>
                <p className="pm-label">Record</p>
                <div className="pm-detail-grid">
                  <p><span>Client</span> {detail.organizationName || `Org ${detail.organizationId}`}</p>
                  <p><span>Charge ID</span> #{detail.id}</p>
                  <p><span>Date</span> {formatChargeDate(detail.createdAt)}</p>
                  <p><span>Type</span> <span className="pm-cap">{detail.feeKind}</span></p>
                  <p><span>Status</span> <StatusBadge status={detail.status} /></p>
                  <p><span>Description</span> {detail.description || "—"}</p>
                </div>
              </section>

              <div className="pm-divider" />

              <section>
                <p className="pm-label">Payment breakdown</p>
                <div className="pm-break-cards">
                  <div>
                    <p>Amount</p>
                    <strong>{formatUsd(detail.amountCents)}</strong>
                  </div>
                  {bill && (
                    <>
                      <div>
                        <p>Month retainer</p>
                        <strong>{formatUsd(bill.breakdown?.monthlyCents)}</strong>
                      </div>
                      <div>
                        <p>Appointments ({bill.breakdown?.appointmentCount || 0})</p>
                        <strong>{formatUsd(bill.breakdown?.appointmentCents)}</strong>
                      </div>
                      <div>
                        <p>Period total</p>
                        <strong>{formatUsd(bill.breakdown?.totalCents)}</strong>
                      </div>
                    </>
                  )}
                </div>
              </section>

              <div className="pm-modal-actions">
                {detail.status !== "paid" && (
                  <button
                    type="button"
                    className="pm-btn pm-btn--ok"
                    disabled={busy === `pay-${detail.id}`}
                    onClick={() => setChargeStatus(detail.id, "paid")}
                  >
                    Mark paid
                  </button>
                )}
                {detail.status !== "waived" && detail.status !== "paid" && (
                  <button
                    type="button"
                    className="pm-btn pm-btn--ghost"
                    disabled={busy === `pay-${detail.id}`}
                    onClick={() => setChargeStatus(detail.id, "waived")}
                  >
                    Waive
                  </button>
                )}
                <button
                  type="button"
                  className="pm-btn pm-btn--primary"
                  onClick={() => printOrWarn(bill ? openPrintableBill(bill) : openPrintableCharge(detail))}
                >
                  Print receipt
                </button>
                {bill && (
                  <button
                    type="button"
                    className="pm-btn pm-btn--ghost"
                    onClick={() =>
                      downloadTextFile(
                        `levios-bill-${bill.organizationId}-${bill.period}.csv`,
                        billToCsv(bill),
                        "text/csv;charset=utf-8"
                      )
                    }
                  >
                    Download CSV
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
