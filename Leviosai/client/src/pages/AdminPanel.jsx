import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { COLORS, S } from "../theme.js";
import { adminApi } from "../api.js";
import { ADMIN_PAGE_PATHS, parseAdminLocation } from "../lib/admin-routes.js";
import { PlatformAnalytics } from "../components/admin/PlatformAnalytics.jsx";
import { WorkspaceList } from "../components/admin/WorkspaceList.jsx";
import { WorkspaceDetail } from "../components/admin/WorkspaceDetail.jsx";
import { StuckEnrollments } from "../components/admin/StuckEnrollments.jsx";
import { CommercialPricingSettings } from "../components/admin/CommercialPricingSettings.jsx";
import { AdminPaymentsPage } from "../components/admin/AdminPaymentsPage.jsx";
import "./admin-shell.css";

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
              <th style={S.th}>Status</th>
              <th style={S.th}>Users</th>
              <th style={S.th}>Workspaces</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id}>
                <td style={S.td}><strong>{o.name}</strong></td>
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
 * Operator admin shell — copper ops styling aligned with SDR pages.
 */
export default function AdminPanel({ user, onLogout }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { page: activePage, workspaceId: selectedWorkspaceId } = parseAdminLocation(location.pathname);
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

  const navSections = [
    {
      label: "Operations",
      items: [
        { key: "overview", label: "Overview" },
        { key: "workspaces", label: "Accounts", badge: workspaceList.length || null },
        { key: "orgs", label: "Organizations" },
        { key: "users", label: "Users" },
      ],
    },
    {
      label: "Commercial",
      items: [
        { key: "pricing", label: "Pricing" },
        { key: "payments", label: "Payments" },
      ],
    },
    {
      label: "SDR",
      items: [
        { key: "enrollments", label: "Stuck SDR", badge: stuck.length > 0 ? stuck.length : null, alert: true },
        { key: "calls", label: "Call history" },
      ],
    },
  ];

  const flatNav = navSections.flatMap((s) => s.items);
  const pageTitle =
    selectedWorkspaceId && activePage === "workspaces"
      ? "Account detail"
      : flatNav.find((n) => n.key === activePage)?.label ?? "Admin";

  const renderContent = () => {
    if (loading) {
      return <div style={{ color: COLORS.textMuted, padding: 40, textAlign: "center" }} role="status">Loading admin data…</div>;
    }
    if (activePage === "workspaces" && selectedWorkspaceId) {
      return (
        <WorkspaceDetail
          workspaceId={selectedWorkspaceId}
          onBack={() => navigate(ADMIN_PAGE_PATHS.workspaces)}
          onChanged={loadGlobal}
        />
      );
    }
    switch (activePage) {
      case "overview":
        return <PlatformAnalytics analytics={analytics} workspaceList={workspaceList} stuck={stuck} />;
      case "pricing":
        return (
          <div>
            <header style={{ marginBottom: 20 }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Pricing</h2>
              <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "6px 0 0", maxWidth: "56ch", lineHeight: 1.45 }}>
                Global monthly retainer (always on) and per-client appointment fees. Open a user to edit their rates.
              </p>
            </header>
            <CommercialPricingSettings />
          </div>
        );
      case "payments":
        return <AdminPaymentsPage />;
      case "workspaces":
        return (
          <WorkspaceList
            workspaceList={workspaceList}
            onRefresh={loadGlobal}
            onSelect={(id) => navigate(`${ADMIN_PAGE_PATHS.workspaces}/${id}`)}
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
    <div className="admin-shell">
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Outfit:wght@600;700&display=swap" rel="stylesheet" />
      <aside className="admin-sidebar" aria-label="Admin navigation">
        <Link to={ADMIN_PAGE_PATHS.overview} className="admin-sidebar-brand">
          <div className="admin-sidebar-mark" aria-hidden="true">L</div>
          <div>
            <strong>Leviosai</strong>
            <span>Operator</span>
          </div>
        </Link>

        <nav className="admin-sidebar-nav">
          {navSections.map((section) => (
            <div key={section.label}>
              <div className="admin-nav-section">{section.label}</div>
              {section.items.map((item) => (
                <NavLink
                  key={item.key}
                  to={ADMIN_PAGE_PATHS[item.key]}
                  end={item.key === "overview"}
                  className={({ isActive }) => `admin-nav-item${isActive ? " is-active" : ""}`}
                >
                  <span>{item.label}</span>
                  {item.badge != null && (
                    <span className={`admin-nav-badge${item.alert ? " is-alert" : ""}`}>{item.badge}</span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="admin-sidebar-user">
          <div className="admin-sidebar-avatar" aria-hidden="true">
            {(user?.firstName || "A")[0]}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>{user ? `${user.firstName} ${user.lastName}` : "Admin"}</strong>
            <span>Operator</span>
          </div>
          <button
            type="button"
            style={{ ...S.btn("ghost"), padding: "8px 10px", minHeight: 40 }}
            onClick={onLogout}
            aria-label="Sign out"
          >
            Out
          </button>
        </div>
      </aside>

      <div className="admin-main">
        <div className="admin-topbar">
          <h1>{pageTitle}</h1>
          <button type="button" style={{ ...S.btn("ghost"), padding: "8px 14px", fontSize: 12, minHeight: 40 }} onClick={loadGlobal}>
            Refresh
          </button>
        </div>
        <div className="admin-content">{renderContent()}</div>
      </div>
    </div>
  );
}
