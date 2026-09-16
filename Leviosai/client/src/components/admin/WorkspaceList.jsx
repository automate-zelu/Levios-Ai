import { useState } from "react";
import { COLORS, S } from "../../theme.js";
import { adminApi } from "../../api.js";

/**
 * Workspace table — activate / open detail. No subscription tiers.
 */
export function WorkspaceList({ workspaceList, onRefresh, onSelect }) {
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState(null);

  const filtered = (workspaceList || []).filter((w) => {
    return !search || w.name?.toLowerCase().includes(search.toLowerCase());
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
    if (!confirm("Reset period usage counters to 0?")) return;
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

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Client accounts</h2>
          <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "3px 0 0" }}>
            {filtered.length} of {(workspaceList || []).length} organization{(workspaceList || []).length !== 1 ? "s" : ""} — one shared SDR per company
          </p>
        </div>
        <input
          style={{ ...S.input, maxWidth: 220, padding: "8px 12px", minHeight: 40 }}
          placeholder="Search workspaces"
          aria-label="Search workspaces"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
        <table style={S.table}>
          <thead>
            <tr style={{ background: COLORS.surfaceAlt }}>
              <th style={S.th}>Workspace</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Leads this period</th>
              <th style={S.th}>Last enrollment</th>
              <th style={S.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((w) => (
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
                </td>
                <td style={S.td}>
                  <span style={S.badge(w.isActive ? COLORS.green : COLORS.red)}>{w.isActive ? "Active" : "Inactive"}</span>
                </td>
                <td style={S.td}>
                  <span style={{ fontWeight: 600 }}>{w.monthlyLeadsUsed ?? 0}</span>
                </td>
                <td style={S.td}>
                  <div style={{ fontSize: 12, color: COLORS.textMuted }}>
                    {w.lastEnrollmentAt ? new Date(w.lastEnrollmentAt).toLocaleDateString() : "—"}
                  </div>
                </td>
                <td style={S.td}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      style={{ ...S.btn("ghost"), padding: "4px 10px", fontSize: 11, minHeight: 36 }}
                      onClick={() => onSelect?.(w.id)}
                    >
                      Rates & detail
                    </button>
                    <button
                      type="button"
                      style={{ ...S.btn(w.isActive ? "danger" : "success"), padding: "4px 10px", fontSize: 11, minHeight: 36, opacity: busyId === w.id ? 0.6 : 1 }}
                      onClick={() => handleToggle(w.id, w.isActive)}
                      disabled={busyId === w.id}
                    >
                      {w.isActive ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      type="button"
                      style={{ ...S.btn("ghost"), padding: "4px 10px", fontSize: 11, minHeight: 36 }}
                      onClick={() => handleReset(w.id)}
                    >
                      Reset usage
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} style={{ ...S.td, textAlign: "center", color: COLORS.textMuted, padding: 40 }}>
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
