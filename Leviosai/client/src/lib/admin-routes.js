/** Admin SPA paths. `/admin-login` is separate and must not match `isAdminAppPath`. */

export const ADMIN_PAGE_PATHS = {
  overview: "/admin",
  workspaces: "/admin/accounts",
  orgs: "/admin/organizations",
  users: "/admin/users",
  pricing: "/admin/pricing",
  payments: "/admin/payments",
  enrollments: "/admin/sdr",
  calls: "/admin/calls",
};

const PATH_TO_PAGE = Object.fromEntries(
  Object.entries(ADMIN_PAGE_PATHS).map(([key, path]) => [path, key])
);

export function isAdminAppPath(pathname) {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function parseAdminLocation(pathname) {
  const raw = String(pathname || "");
  const normalized = raw.length > 1 ? raw.replace(/\/+$/, "") : raw;

  const detail = normalized.match(/^\/admin\/accounts\/([^/]+)$/);
  if (detail) {
    return { page: "workspaces", workspaceId: decodeURIComponent(detail[1]), known: true };
  }

  const page = PATH_TO_PAGE[normalized];
  if (page) {
    return { page, workspaceId: null, known: true };
  }

  return { page: "overview", workspaceId: null, known: false };
}

export function safeAdminNext(search) {
  const next = new URLSearchParams(typeof search === "string" ? search : "").get("next") || "";
  if (!next.startsWith("/admin") || next.startsWith("/admin-login")) return "/admin";
  if (next.startsWith("//") || next.includes("://")) return "/admin";
  return next;
}
