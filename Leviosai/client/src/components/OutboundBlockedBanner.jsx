import { COLORS } from "../theme.js";

/**
 * Clear lock state when calling / SMS / email are blocked (unpaid or paused).
 */
export default function OutboundBlockedBanner({
  blocked,
  message,
  onOpenBilling,
  compact = false,
}) {
  if (!blocked) return null;
  const copy =
    message ||
    "Outbound calling, SMS, and email are locked until billing is active. Open Billing to subscribe or reactivate.";

  return (
    <div
      role="alert"
      style={{
        marginBottom: compact ? 0 : 16,
        padding: compact ? "12px 14px" : "14px 16px",
        borderRadius: 12,
        background: "rgba(231,76,60,0.14)",
        border: "1px solid rgba(231,76,60,0.5)",
        color: "#f5b7b1",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <div style={{ fontWeight: 700, color: "#fff", marginBottom: 4, fontSize: 14 }}>
        Calling &amp; messaging locked
      </div>
      <div>{copy}</div>
      {onOpenBilling && (
        <button
          type="button"
          onClick={onOpenBilling}
          style={{
            marginTop: 10,
            background: `linear-gradient(135deg, ${COLORS.orange}, ${COLORS.orangeDark || "#d35400"})`,
            border: "none",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 13,
            padding: "8px 14px",
            borderRadius: 8,
          }}
        >
          Open Billing
        </button>
      )}
    </div>
  );
}
