import { COLORS, S } from "../theme.js";

/**
 * Custom 404 — used for unknown public and authenticated SPA paths.
 */
export default function NotFoundPage({ onHome, homeLabel = "Go home" }) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: `radial-gradient(ellipse at 40% 0%, ${COLORS.orangeGlow}, transparent 55%), ${COLORS.bg}`,
        color: COLORS.text,
        fontFamily: "'DM Sans', system-ui, sans-serif",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 420 }}>
        <div style={{ fontSize: 56, fontWeight: 800, color: COLORS.orange, letterSpacing: "-0.04em", marginBottom: 8 }}>
          404
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 8px" }}>Page not found</h1>
        <p style={{ color: COLORS.textMuted, fontSize: 14, lineHeight: 1.55, margin: "0 0 24px" }}>
          That URL isn&apos;t part of Catalyst. Check the address or head back to a known page.
        </p>
        <button type="button" style={{ ...S.btn("primary"), minHeight: 44, minWidth: 160 }} onClick={onHome}>
          {homeLabel}
        </button>
      </div>
    </div>
  );
}
