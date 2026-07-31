import { useState } from "react";
import { COLORS, S } from "../../theme.js";
import { adminApi } from "../../api.js";
import { ADMIN_TIER_OPTIONS, isWorkspaceNearLimit, tierBadgeColor } from "../../lib/admin-helpers.js";

/**
 * Paginated workspace table (plan §13.5 WorkspaceList).
 */
export function WorkspaceList({ workspaceList, onRefresh, onSelect }) {
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("all");
  const [changingTier, setChangingTier] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const filtered = (workspaceList || []).filter((w) => {
    const matchSearch = !search || w.name?.toLowerCase().includes(search.toLowerCase());
    const matchTier = tierFilter === "all" || w.tier === tierFilter;
    return matchSearch && matchTier;
  });

  const handleToggle = async (id, current) => {
    setBusyId(id);
    try {
      await adminApi.setWorkspaceStatus(id, !current);
      onRefresh?.();
    } catch (e) {
      alert(e.message || "Failed to update status");
    } finally {
      setBusyId(null);
    }
  };

  const handleReset = async (id) => {
    if (!confirm("Reset monthly usage to 0?")) return;
    setBusyId(id);
    try {
      await adminApi.resetUsage(id);
      onRefresh?.();
    } catch (e) {
      alert(e.message || "Reset failed");
    } finally {
      setBusyId(null);
    }
  };

  const handleTierChange = async (id, tier) => {
    setChangingTier(id);
    try {
      await adminApi.setWorkspaceTier(id, tier);
      onRefresh?.();
    } catch (e) {
      alert(e.message || "Tier change failed");
    } finally {
      setChangingTier(null);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Workspaces</h2>
          <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "3px 0 0" }}>
            {filtered.length} of {(workspaceList || []).length} workspace{(workspaceList || []).length !== 1 ? "s" : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            style={{ ...S.input, maxWidth: 200, padding: "8px 12px" }}
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select style={{ ...S.input, width: "auto", padding: "8px 12px" }} value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
            <option value="all">All Tiers</option>
            {ADMIN_TIER_OPTIONS.map((t) => (
              <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
        <table style={S.table}>
          <thead>
            <tr style={{ background: COLORS.surfaceAlt }}>
              <th style={S.th}>Workspace</th>
              <th style={S.th}>Tier</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Lead Usage</th>
              <th style={S.th}>Last Active</th>
              <th style={S.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((w) => {
              const near = isWorkspaceNearLimit(w);
              return (
                <tr key={w.id} style={{ borderBottom: `1px solid ${COLORS.border}22` }}>
                  <td style={S.td}>
                    <button
                      type="button"
                      onClick={() => onSelect?.(w.id)}
                      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", color: COLORS.text, fontFamily: "inherit" }}
                    >
                      <div style={{ fontWeight: 600, fontSize: 13, color: COLORS.orange }}>{w.name}</div>
                      <div style={{ fontSize: 10, color: COLORS.textMuted, fontFamily: "monospace", marginTop: 2 }}>
                        {String(w.id).slice(0, 14)}…
                      </div>
                    </button>
                    {near && (
                      <span style={{ ...S.badge(COLORS.yellow), marginTop: 6, display: "inline-block" }}>Near limit</span>
                    )}
                  </td>
                  <td style={S.td}>
                    <select
                      style={{ ...S.input, width: "auto", fontSize: 12, padding: "4px 8px", opacity: changingTier === w.id ? 0.5 : 1 }}
                      value={w.tier}
                      onChange={(e) => handleTierChange(w.id, e.target.value)}
                      disabled={changingTier === w.id}
                    >
                      {ADMIN_TIER_OPTIONS.map((t) => (
                        <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>
                      ))}
                    </select>
                  </td>
                  <td style={S.td}>
                    <span style={S.badge(w.isActive ? COLORS.green : COLORS.red)}>{w.isActive ? "Active" : "Inactive"}</span>
                  </td>
                  <td style={S.td}>
                    <div style={{ fontSize: 12, marginBottom: 4, color: COLORS.textMuted }}>
                      <span style={{ color: COLORS.text, fontWeight: 600 }}>{w.monthlyLeadsUsed}</span> / {w.monthlyLeadLimit}
                    </div>
                    <div style={{ background: COLORS.surfaceAlt, borderRadius: 3, height: 5, width: 100 }}>
                      <div
                        style={{
                          height: 5,
                          borderRadius: 3,
                          background: near ? COLORS.red : COLORS.orange,
                          width: `${Math.min(100, (w.monthlyLeadsUsed / (w.monthlyLeadLimit || 1)) * 100)}%`,
                        }}
                      />
                    </div>
                  </td>
                  <td style={S.td}>
                    <div style={{ fontSize: 12, color: COLORS.textMuted }}>
                      {w.lastEnrollmentAt ? new Date(w.lastEnrollmentAt).toLocaleDateString() : "—"}
                    </div>
                  </td>
                  <td style={S.td}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        style={{ ...S.btn("ghost"), padding: "4px 10px", fontSize: 11 }}
                        onClick={() => onSelect?.(w.id)}
                      >
                        Detail
                      </button>
                      <button
                        style={{ ...S.btn(w.isActive ? "danger" : "success"), padding: "4px 10px", fontSize: 11, opacity: busyId === w.id ? 0.6 : 1 }}
                        onClick={() => handleToggle(w.id, w.isActive)}
                        disabled={busyId === w.id}
                      >
                        {w.isActive ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        style={{ ...S.btn("ghost"), padding: "4px 10px", fontSize: 11 }}
                        onClick={() => handleReset(w.id)}
                      >
                        Reset
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} style={{ ...S.td, textAlign: "center", color: COLORS.textMuted, padding: 40 }}>
                  No workspaces found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
