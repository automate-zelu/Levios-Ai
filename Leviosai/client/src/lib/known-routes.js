/** Paths the SPA intentionally handles (everything else → custom 404). */

export const PUBLIC_PATHS = new Set([
  "/",
  "/home",
  "/privacy",
  "/terms",
  "/register",
  "/admin-login",
]);

export const APP_PATHS = new Set([
  "/",
  "/leads",
  "/campaigns",
  "/bookings",
  "/appointments",
  "/replay",
  "/sandbox",
  "/proposals",
  "/sdr",
  "/calling",
  "/live-calls",
  "/inbox",
  "/sdr-sms",
  "/sdr-email",
  "/sdr-setup",
  "/integrations",
  "/billing",
  "/settings",
  "/twilio",
  "/voice-ai",
]);

export function isLeadDetailPath(pathname) {
  return /^\/leads\/[^/]+$/.test(pathname || "");
}

export function isKnownPublicPath(pathname) {
  const p = String(pathname || "").replace(/\/+$/, "") || "/";
  if (PUBLIC_PATHS.has(p) || PUBLIC_PATHS.has(pathname)) return true;
  if (p === "/admin" || p.startsWith("/admin/")) return true;
  return false;
}

export function isKnownAppPath(pathname) {
  const p = String(pathname || "").replace(/\/+$/, "") || "/";
  if (APP_PATHS.has(p) || APP_PATHS.has(pathname)) return true;
  if (isLeadDetailPath(p)) return true;
  if (p === "/admin" || p.startsWith("/admin/")) return true;
  return false;
}
