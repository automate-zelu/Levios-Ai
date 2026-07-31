import { COLORS, S } from "../../theme.js";

const FIELDS = [
  { key: "dormantDays", label: "Dormant Threshold (days)", help: "Days of inactivity before enrolling a lead" },
  { key: "waitCallHrs", label: "Wait After Call (hours)", help: "Delay before sending SMS after a missed call" },
  { key: "waitSmsHrs", label: "Wait After SMS (hours)", help: "Timeout before sending email if no SMS reply" },
  { key: "reEnrollDays", label: "Re-enrollment Delay (days)", help: "Days to wait before re-enrolling an exhausted lead" },
];

export function ThresholdSettings({ values, onChange }) {
  return (
    <div style={S.card}>
      <div style={S.cardHeader}>Sequence Thresholds</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }} htmlFor={`threshold-${f.key}`}>
              {f.label}
            </label>
            <input
              id={`threshold-${f.key}`}
              type="number"
              min="1"
              style={S.input}
              value={values[f.key]}
              onChange={(e) => onChange(f.key, parseInt(e.target.value, 10) || 1)}
            />
            <div style={{ fontSize: 11, color: COLORS.textDim, marginTop: 3 }}>{f.help}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
