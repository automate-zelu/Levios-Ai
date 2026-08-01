// Shared design tokens + style helpers for Leviosai CRM UI.
// Keep App.jsx and extracted Module 3 components visually consistent.

export const COLORS = {
  bg: "#0a0a0a", surface: "#141414", surfaceAlt: "#1a1a1a",
  border: "#2a2a2a", borderLight: "#333",
  text: "#e8e8e8", textMuted: "#888", textDim: "#555",
  orange: "#e67e22", orangeLight: "#f39c12", orangeDark: "#d35400",
  orangeGlow: "rgba(230,126,34,0.15)",
  green: "#27ae60", greenLight: "#2ecc71", red: "#e74c3c",
  blue: "#3498db", purple: "#9b59b6", yellow: "#f1c40f",
  teal: "#1abc9c",
};

export const S = {
  card: { background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 24, marginBottom: 20 },
  cardHeader: { fontSize: 15, fontWeight: 600, marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" },
  statCard: (color) => ({
    background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "20px 24px",
    borderTop: `3px solid ${color}`, flex: 1, minWidth: 180,
  }),
  badge: (color) => ({
    display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
    background: `${color}22`, color: color, border: `1px solid ${color}44`,
  }),
  btn: (v = "primary") => ({
    padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
    fontFamily: "inherit", transition: "all 0.2s",
    ...(v === "primary" ? { background: `linear-gradient(135deg, ${COLORS.orange}, ${COLORS.orangeDark})`, color: "#fff" } : {}),
    ...(v === "secondary" ? { background: COLORS.surfaceAlt, color: COLORS.text, border: `1px solid ${COLORS.border}` } : {}),
    ...(v === "ghost" ? { background: "transparent", color: COLORS.textMuted, border: `1px solid ${COLORS.border}` } : {}),
    ...(v === "success" ? { background: COLORS.green, color: "#fff" } : {}),
    ...(v === "danger" ? { background: COLORS.red, color: "#fff" } : {}),
    ...(v === "teal" ? { background: COLORS.teal, color: "#fff" } : {}),
  }),
  input: { width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${COLORS.border}`, background: COLORS.surfaceAlt, color: COLORS.text, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" },
  select: { padding: "10px 14px", borderRadius: 8, border: `1px solid ${COLORS.border}`, background: COLORS.surfaceAlt, color: COLORS.text, fontSize: 13, fontFamily: "inherit", outline: "none", width: "100%" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "10px 14px", borderBottom: `1px solid ${COLORS.border}`, color: COLORS.textMuted, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 },
  td: { padding: "12px 14px", borderBottom: `1px solid ${COLORS.border}22` },
  tab: (active) => ({
    padding: "8px 18px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: active ? 600 : 400,
    background: active ? COLORS.orangeGlow : "transparent",
    color: active ? COLORS.orangeLight : COLORS.textMuted,
    border: active ? `1px solid ${COLORS.orange}44` : "1px solid transparent", transition: "all 0.2s",
  }),
};

/** Usage helpers shared by UsageBar + UpgradePrompt */
export const USAGE_WARN_RATIO = 0.9;

export function usageRatio(used, limit) {
  if (!limit || limit <= 0) return 0;
  return used / limit;
}

export function isNearLimit(used, limit, threshold = USAGE_WARN_RATIO) {
  return usageRatio(used, limit) >= threshold;
}

export function formatDuration(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
