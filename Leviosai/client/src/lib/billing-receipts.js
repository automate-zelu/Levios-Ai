/** Shared money + receipt download helpers for admin/user billing UIs. */

export function formatUsd(cents) {
  const n = Number(cents) || 0;
  return `$${(n / 100).toLocaleString("en-US", {
    minimumFractionDigits: n % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

export function currentPeriodKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function periodYears(span = 6, from = new Date()) {
  const y = from.getFullYear();
  return Array.from({ length: span }, (_, i) => y - i);
}

export function monthOptions() {
  return [
    { value: "01", label: "January" },
    { value: "02", label: "February" },
    { value: "03", label: "March" },
    { value: "04", label: "April" },
    { value: "05", label: "May" },
    { value: "06", label: "June" },
    { value: "07", label: "July" },
    { value: "08", label: "August" },
    { value: "09", label: "September" },
    { value: "10", label: "October" },
    { value: "11", label: "November" },
    { value: "12", label: "December" },
  ];
}

export function formatChargeDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(iso);
  }
}

export function downloadTextFile(filename, content, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function billToCsv(bill) {
  const rows = [
    ["Organization", bill.organizationName || ""],
    ["Period", bill.periodLabel || bill.period || ""],
    ["Total", formatUsd(bill.breakdown?.totalCents)],
    ["Paid", formatUsd(bill.breakdown?.paidCents)],
    ["Pending", formatUsd(bill.breakdown?.pendingCents)],
    [],
    ["ID", "Kind", "Status", "Amount", "Description", "Created"],
    ...(bill.lines || []).map((l) => [
      l.id,
      l.feeKind,
      l.status,
      (l.amountCents / 100).toFixed(2),
      (l.description || "").replace(/,/g, ";"),
      l.createdAt ? new Date(l.createdAt).toISOString() : "",
    ]),
  ];
  return rows.map((r) => r.join(",")).join("\n");
}

export function chargesToCsv(charges, meta = {}) {
  const rows = [
    ["Leviosai payment ledger"],
    ["Title", meta.title || "Transactions"],
    ["Generated", new Date().toISOString()],
    ["Count", String((charges || []).length)],
    [],
    ["ID", "Date", "Client", "Type", "Status", "Amount", "Description"],
    ...(charges || []).map((c) => [
      c.id,
      c.createdAt ? new Date(c.createdAt).toISOString() : "",
      (c.organizationName || `Org ${c.organizationId || ""}`).replace(/,/g, ";"),
      c.feeKind || "",
      c.status || "",
      ((c.amountCents || 0) / 100).toFixed(2),
      (c.description || "").replace(/,/g, ";"),
    ]),
  ];
  return rows.map((r) => r.join(",")).join("\n");
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function printStyles() {
  return `
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { font-family: Georgia, "Times New Roman", serif; color: #1a1a1a; margin: 28px; background: #fff; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 20px; }
    .toolbar button { min-height: 40px; padding: 8px 14px; font: 14px/1.2 system-ui, sans-serif; cursor: pointer; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .muted { color: #555; font-size: 13px; margin: 0 0 18px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom: 1px solid #ddd; padding: 8px 6px; text-align: left; vertical-align: top; }
    th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #666; }
    .totals { margin-top: 20px; font-size: 14px; }
    .totals strong { font-size: 18px; }
    @media print {
      .toolbar { display: none !important; }
      body { margin: 12mm; }
    }
  `;
}

function printShell({ title, heading, subtitle, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <style>${printStyles()}</style>
</head>
<body>
  <div class="toolbar">
    <button type="button" id="print-btn">Print</button>
  </div>
  <h1>${esc(heading)}</h1>
  <p class="muted">${esc(subtitle)}</p>
  ${body}
  <script>
    (function () {
      var btn = document.getElementById("print-btn");
      if (btn) btn.addEventListener("click", function () { window.focus(); window.print(); });
      function go() {
        window.focus();
        window.print();
      }
      if (document.readyState === "complete") setTimeout(go, 200);
      else window.addEventListener("load", function () { setTimeout(go, 200); });
    })();
  </script>
</body>
</html>`;
}

export function billToPrintHtml(bill) {
  const lines = (bill.lines || [])
    .map(
      (l) => `<tr>
      <td>${esc(l.feeKind)}</td>
      <td>${esc(l.status)}</td>
      <td>${esc(l.description || "")}</td>
      <td style="text-align:right">${formatUsd(l.amountCents)}</td>
    </tr>`
    )
    .join("");
  const org = bill.organizationName || "Levios";
  const period = bill.periodLabel || bill.period || "";
  return printShell({
    title: `Receipt — ${org} — ${period}`,
    heading: "Leviosai receipt",
    subtitle: `${org} · ${period}`,
    body: `
      <table>
        <thead><tr><th>Type</th><th>Status</th><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>${lines || `<tr><td colspan="4">No line items</td></tr>`}</tbody>
      </table>
      <div class="totals">
        <div>Monthly: ${formatUsd(bill.breakdown?.monthlyCents)}</div>
        <div>Appointments (${bill.breakdown?.appointmentCount || 0}): ${formatUsd(bill.breakdown?.appointmentCents)}</div>
        <div><strong>Total: ${formatUsd(bill.breakdown?.totalCents)}</strong></div>
        <div class="muted">Paid ${formatUsd(bill.breakdown?.paidCents)} · Pending ${formatUsd(bill.breakdown?.pendingCents)}</div>
      </div>`,
  });
}

export function chargesLedgerToPrintHtml(charges, meta = {}) {
  const rows = (charges || [])
    .map(
      (c) => `<tr>
      <td>${esc(formatChargeDate(c.createdAt))}</td>
      <td>${esc(c.organizationName || (c.organizationId ? `Org ${c.organizationId}` : "—"))}</td>
      <td>${esc(c.feeKind)}</td>
      <td>${esc(c.status)}</td>
      <td>${esc(c.description || "")}</td>
      <td style="text-align:right">${formatUsd(c.amountCents)}</td>
    </tr>`
    )
    .join("");
  const total = (charges || []).reduce((s, c) => s + (c.amountCents || 0), 0);
  const paid = (charges || [])
    .filter((c) => c.status === "paid")
    .reduce((s, c) => s + (c.amountCents || 0), 0);
  return printShell({
    title: meta.title || "Payment ledger",
    heading: meta.title || "Leviosai payment ledger",
    subtitle: `${meta.subtitle || ""} · ${(charges || []).length} transactions · Generated ${new Date().toLocaleString()}`,
    body: `
      <table>
        <thead>
          <tr>
            <th>Date</th><th>Client</th><th>Type</th><th>Status</th><th>Description</th><th style="text-align:right">Amount</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="6">No transactions</td></tr>`}</tbody>
      </table>
      <div class="totals">
        <div>Paid: ${formatUsd(paid)}</div>
        <div><strong>Listed total: ${formatUsd(total)}</strong></div>
      </div>`,
  });
}

export function chargeToPrintHtml(charge) {
  const name = charge.organizationName || (charge.organizationId ? `Org ${charge.organizationId}` : "Leviosai");
  return printShell({
    title: `Receipt #${charge.id || ""} — ${name}`,
    heading: "Leviosai receipt",
    subtitle: `${name} · Charge #${charge.id || "—"}`,
    body: `
      <table>
        <tbody>
          <tr><th>Date</th><td>${esc(formatChargeDate(charge.createdAt))}</td></tr>
          <tr><th>Type</th><td>${esc(charge.feeKind || "—")}</td></tr>
          <tr><th>Status</th><td>${esc(charge.status || "—")}</td></tr>
          <tr><th>Description</th><td>${esc(charge.description || "—")}</td></tr>
          <tr><th>Amount</th><td style="text-align:right"><strong>${formatUsd(charge.amountCents)}</strong></td></tr>
        </tbody>
      </table>`,
  });
}

function printViaHiddenIframe(url) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "Print receipt");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "0",
    height: "0",
    border: "0",
  });
  iframe.src = url;
  document.body.appendChild(iframe);

  const cleanup = () => {
    iframe.remove();
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  };

  iframe.addEventListener("load", () => {
    const win = iframe.contentWindow;
    if (!win) {
      cleanup();
      return;
    }
    win.addEventListener("afterprint", cleanup);
    try {
      win.focus();
      win.print();
    } catch {
      cleanup();
      return;
    }
    window.setTimeout(cleanup, 60_000);
  });
  return true;
}

/**
 * Open the browser print dialog for a receipt.
 * Uses a blob URL. If the popup is blocked, prints via a hidden iframe.
 */
export function openPrintableHtml(html) {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  try {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    // Do not pass "noopener" — many browsers then return null from window.open.
    const popup = window.open(url, "_blank");
    if (popup) {
      try {
        popup.opener = null;
      } catch {
        /* ignore */
      }
      window.setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* ignore */
        }
      }, 120_000);
      return true;
    }
    return printViaHiddenIframe(url);
  } catch {
    return false;
  }
}

export function openPrintableBill(bill) {
  if (!bill) return false;
  return openPrintableHtml(billToPrintHtml(bill));
}

export function openPrintableChargesLedger(charges, meta = {}) {
  return openPrintableHtml(chargesLedgerToPrintHtml(charges, meta));
}

export function openPrintableCharge(charge) {
  if (!charge) return false;
  return openPrintableHtml(chargeToPrintHtml(charge));
}

export function printOrWarn(ok) {
  if (ok) return true;
  window.alert("Could not open the print dialog. Check that printing is allowed in this browser.");
  return false;
}
