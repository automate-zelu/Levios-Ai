import { useEffect, useState } from "react";
import { COLORS, S } from "../../theme.js";
import { adminApi } from "../../api.js";
import { ADMIN_TIER_OPTIONS, tierBadgeColor } from "../../lib/admin-helpers.js";

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
 * Per-workspace management: tier, activate, usage reset, Twilio, enrollments.
 */
export function WorkspaceDetail({ workspaceId, onBack, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [enrollments, setEnrollments] = useState([]);
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

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

  const setTier = async (tier) => {
    setBusy(true);
    try {
      await adminApi.setWorkspaceTier(workspaceId, tier);
      await load();
      onChanged?.();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

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
          <span style={S.badge(tierBadgeColor(ws.tier, COLORS))}>{ws.tier}</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {["overview", "enrollments", "twilio"].map((t) => (
          <div key={t} style={S.tab(tab === t)} onClick={() => setTab(t)}>
            {t === "overview" ? "Overview" : t === "enrollments" ? "Enrollments" : "Twilio"}
          </div>
        ))}
      </div>

      {tab === "overview" && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={S.card}>
            <div style={S.cardHeader}>Billing & limits</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 14, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: COLORS.textMuted }}>Org plan</div>
                <div style={{ fontWeight: 600 }}>{detail.organization?.plan || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: COLORS.textMuted }}>Leads used</div>
                <div style={{ fontWeight: 600 }}>{ws.monthlyLeadsUsed} / {ws.monthlyLeadLimit}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: COLORS.textMuted }}>Minutes used</div>
                <div style={{ fontWeight: 600 }}>{ws.monthlyMinutesUsed} / {ws.monthlyMinuteLimit}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: COLORS.textMuted }}>Booked rate</div>
                <div style={{ fontWeight: 600 }}>{detail.enrollmentStats?.bookedRate ?? 0}%</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <select
                style={{ ...S.input, width: "auto" }}
                value={ws.tier}
                disabled={busy}
                onChange={(e) => setTier(e.target.value)}
              >
                {ADMIN_TIER_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <button style={S.btn(ws.isActive ? "danger" : "success")} onClick={toggle} disabled={busy}>
                {ws.isActive ? "Deactivate" : "Activate"}
              </button>
              <button style={S.btn("ghost")} onClick={reset} disabled={busy}>Reset usage</button>
            </div>
          </div>

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
