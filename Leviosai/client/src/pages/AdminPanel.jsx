import { useEffect, useState } from "react";
import { COLORS, S } from "../theme.js";
import { adminApi } from "../api.js";
import { PlatformAnalytics } from "../components/admin/PlatformAnalytics.jsx";
import { WorkspaceList } from "../components/admin/WorkspaceList.jsx";
import { WorkspaceDetail } from "../components/admin/WorkspaceDetail.jsx";
import { StuckEnrollments } from "../components/admin/StuckEnrollments.jsx";
import { tierBadgeColor } from "../lib/admin-helpers.js";

function OrgsPage() {
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi.getOrganizations().then(setOrgs).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ color: COLORS.textMuted }}>Loading organizations…</div>;

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 16px" }}>Organizations</h2>
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
        <table style={S.table}>
          <thead>
            <tr style={{ background: COLORS.surfaceAlt }}>
              <th style={S.th}>Organization</th>
              <th style={S.th}>Tier</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Users</th>
              <th style={S.th}>Workspaces</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id}>
                <td style={S.td}><strong>{o.name}</strong></td>
                <td style={S.td}><span style={S.badge(tierBadgeColor(o.tier, COLORS))}>{o.tier}</span></td>
                <td style={S.td}><span style={S.badge(o.isActive ? COLORS.green : COLORS.red)}>{o.isActive ? "Active" : "Inactive"}</span></td>
                <td style={S.td}>{o.userCount}</td>
                <td style={S.td}>{o.workspaceCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UsersPage() {
  const [userList, setUserList] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = () =>
    adminApi.getUsers().then(setUserList).catch(() => {}).finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const filtered = userList.filter((u) => {
    const q = search.toLowerCase();
    return !q || u.email?.toLowerCase().includes(q) || u.firstName?.toLowerCase().includes(q);
  });

  const setRole = async (id, role) => {
    try {
      await adminApi.setUserRole(id, role);
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  if (loading) return <div style={{ color: COLORS.textMuted }}>Loading users…</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, gap: 12 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Users</h2>
        <input style={{ ...S.input, maxWidth: 220 }} placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
        <table style={S.table}>
          <thead>
            <tr style={{ background: COLORS.surfaceAlt }}>
              <th style={S.th}>User</th>
              <th style={S.th}>Org</th>
              <th style={S.th}>Role</th>
              <th style={S.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id}>
                <td style={S.td}>
                  <div style={{ fontWeight: 600 }}>{u.firstName} {u.lastName}</div>
                  <div style={{ fontSize: 11, color: COLORS.textMuted }}>{u.email}</div>
                </td>
                <td style={S.td}>{u.orgName || "—"}</td>
                <td style={S.td}><span style={S.badge(u.role === "admin" ? COLORS.purple : COLORS.blue)}>{u.role}</span></td>
                <td style={S.td}>
                  {u.role === "admin" ? (
                    <button style={{ ...S.btn("ghost"), padding: "4px 10px", fontSize: 11 }} onClick={() => setRole(u.id, "user")}>Demote</button>
                  ) : (
                    <button style={{ ...S.btn("secondary"), padding: "4px 10px", fontSize: 11 }} onClick={() => setRole(u.id, "admin")}>Make Admin</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CallsPage({ workspaceList }) {
  const [sessions, setSessions] = useState([]);
  const [filterWs, setFilterWs] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await adminApi.getCalls({ page: 1, limit: 50, workspaceId: filterWs || undefined });
      setSessions(data.data || []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, [filterWs]);

  if (selected) {
    return (
      <div>
        <button style={{ ...S.btn("ghost"), marginBottom: 16 }} onClick={() => setSelected(null)}>← Back</button>
        <div style={S.card}>
          <div style={S.cardHeader}>Call detail</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 12, fontSize: 13 }}>
            <div>Lead: <strong>{selected.leadName || "—"}</strong></div>
            <div>Workspace: <strong>{selected.workspaceName || "—"}</strong></div>
            <div>Outcome: <strong>{selected.outcome || "—"}</strong></div>
            <div>Duration: <strong>{selected.durationSeconds != null ? `${selected.durationSeconds}s` : "—"}</strong></div>
          </div>
          {selected.aiSummary && <p style={{ marginTop: 16, lineHeight: 1.5 }}>{selected.aiSummary}</p>}
          {selected.transcript && (
            <pre style={{ marginTop: 16, whiteSpace: "pre-wrap", fontSize: 12, background: COLORS.surfaceAlt, padding: 12, borderRadius: 8, maxHeight: 360, overflow: "auto" }}>
              {selected.transcript}
            </pre>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, flex: 1 }}>Call History</h2>
        <select style={{ ...S.input, width: "auto" }} value={filterWs} onChange={(e) => setFilterWs(e.target.value)}>
          <option value="">All workspaces</option>
          {(workspaceList || []).map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
        <button style={S.btn("ghost")} onClick={load}>↻</button>
      </div>
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: COLORS.textMuted }}>Loading…</div>
        ) : (
          <table style={S.table}>
            <thead>
              <tr style={{ background: COLORS.surfaceAlt }}>
                <th style={S.th}>Lead</th>
                <th style={S.th}>Workspace</th>
                <th style={S.th}>Outcome</th>
                <th style={S.th}>Started</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} style={{ cursor: "pointer" }} onClick={() => setSelected(s)}>
                  <td style={S.td}>{s.leadName || "—"}</td>
                  <td style={S.td}>{s.workspaceName || "—"}</td>
                  <td style={S.td}><span style={S.badge(COLORS.blue)}>{s.outcome || s.status || "—"}</span></td>
                  <td style={S.td}>{s.startedAt ? new Date(s.startedAt).toLocaleString() : "—"}</td>
                </tr>
              ))}
              {sessions.length === 0 && (
                <tr><td colSpan={4} style={{ ...S.td, textAlign: "center", color: COLORS.textMuted, padding: 32 }}>No calls</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/**
 * Operator admin shell — plan §13.5 AdminPanel + RequireRole (gated by App).
 */
export default function AdminPanel({ user, onLogout }) {
  const [activePage, setActivePage] = useState("overview");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(null);
  const [workspaceList, setWorkspaceList] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [stuck, setStuck] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadGlobal = () => {
    Promise.all([
      adminApi.getWorkspaces(),
      adminApi.getAnalytics(),
      adminApi.getStuck(),
    ])
      .then(([ws, a, s]) => {
        setWorkspaceList(Array.isArray(ws) ? ws : []);
        setAnalytics(a);
        setStuck(Array.isArray(s) ? s : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(loadGlobal, []);

  const navItems = [
    { key: "overview", icon: "📊", label: "Overview" },
    { key: "workspaces", icon: "🏢", label: "Workspaces", badge: workspaceList.length || null },
    { key: "orgs", icon: "🏛️", label: "Organizations" },
    { key: "users", icon: "👥", label: "Users" },
    { key: "enrollments", icon: "🤖", label: "Stuck SDR", badge: stuck.length > 0 ? stuck.length : null, badgeColor: COLORS.red },
    { key: "calls", icon: "📞", label: "Call History" },
  ];

  const renderContent = () => {
    if (loading) {
      return <div style={{ color: COLORS.textMuted, padding: 40, textAlign: "center" }}>Loading admin data…</div>;
    }
    if (activePage === "workspaces" && selectedWorkspaceId) {
      return (
        <WorkspaceDetail
          workspaceId={selectedWorkspaceId}
          onBack={() => setSelectedWorkspaceId(null)}
          onChanged={loadGlobal}
        />
      );
    }
    switch (activePage) {
      case "overview":
        return <PlatformAnalytics analytics={analytics} workspaceList={workspaceList} stuck={stuck} />;
      case "workspaces":
        return (
          <WorkspaceList
            workspaceList={workspaceList}
            onRefresh={loadGlobal}
            onSelect={(id) => setSelectedWorkspaceId(id)}
          />
        );
      case "orgs":
        return <OrgsPage />;
      case "users":
        return <UsersPage />;
      case "enrollments":
        return <StuckEnrollments stuck={stuck} onRefresh={loadGlobal} />;
      case "calls":
        return <CallsPage workspaceList={workspaceList} />;
      default:
        return null;
    }
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: COLORS.bg, color: COLORS.text, fontFamily: "'DM Sans','Outfit',system-ui,sans-serif", overflow: "hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Outfit:wght@600;700&display=swap" rel="stylesheet" />
      <div style={{ width: 240, background: COLORS.surface, borderRight: `1px solid ${COLORS.border}`, display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "20px 20px 16px", borderBottom: `1px solid ${COLORS.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: `linear-gradient(135deg,${COLORS.purple},#7d3c98)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>🛡</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Leviosai</div>
              <div style={{ fontSize: 10, color: COLORS.purple, fontWeight: 600, letterSpacing: 0.8 }}>OPERATOR PORTAL</div>
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "12px 0" }}>
          <div style={{ padding: "6px 20px 8px", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5, color: COLORS.textDim }}>Management</div>
          {navItems.map((item) => {
            const active = activePage === item.key;
            return (
              <div
                key={item.key}
                onClick={() => {
                  setActivePage(item.key);
                  if (item.key !== "workspaces") setSelectedWorkspaceId(null);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 20px",
                  cursor: "pointer",
                  fontSize: 13,
                  background: active ? "rgba(155,89,182,0.12)" : "transparent",
                  color: active ? COLORS.purple : COLORS.textMuted,
                  borderLeft: active ? `3px solid ${COLORS.purple}` : "3px solid transparent",
                  fontWeight: active ? 600 : 400,
                }}
              >
                <span>{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.badge != null && (
                  <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 10, background: item.badgeColor || COLORS.blue, color: "#fff", fontWeight: 700 }}>
                    {item.badge}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ padding: "14px 20px", borderTop: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 7, background: `linear-gradient(135deg,${COLORS.purple},#7d3c98)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff" }}>
            {(user?.firstName || "A")[0]}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {user ? `${user.firstName} ${user.lastName}` : "Admin"}
            </div>
            <div style={{ fontSize: 10, color: COLORS.purple }}>Operator</div>
          </div>
          <button style={{ background: "none", border: "none", color: COLORS.textMuted, cursor: "pointer", fontSize: 16 }} onClick={onLogout} title="Sign out">⏻</button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 28px", borderBottom: `1px solid ${COLORS.border}`, background: COLORS.surface, flexShrink: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.text }}>
            {selectedWorkspaceId && activePage === "workspaces"
              ? "Workspace Detail"
              : navItems.find((n) => n.key === activePage)?.label ?? "Admin"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button style={{ ...S.btn("ghost"), padding: "6px 14px", fontSize: 12 }} onClick={loadGlobal}>↻ Refresh</button>
            <span style={{ fontSize: 11, color: COLORS.textMuted }}>Platform · M6</span>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 28 }}>{renderContent()}</div>
      </div>
    </div>
  );
}
