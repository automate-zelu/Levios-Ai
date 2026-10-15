/**
 * Sandbox is internal / demo only (P2.5).
 * Allowed when: admin role, VITE_ENABLE_SANDBOX=true, or local override flag.
 */

export function canAccessSandbox(userOrRole) {
  const role =
    typeof userOrRole === "string"
      ? userOrRole
      : userOrRole?.role ?? null;
  if (role === "admin") return true;
  try {
    if (typeof import.meta !== "undefined" && import.meta.env?.VITE_ENABLE_SANDBOX === "true") {
      return true;
    }
  } catch {
    /* non-vite */
  }
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem("catalyst_sandbox") === "1") {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}
