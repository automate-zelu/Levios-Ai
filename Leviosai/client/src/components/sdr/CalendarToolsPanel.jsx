import { useEffect, useState } from "react";
import { COLORS, S } from "../../theme.js";
import { calendarApi } from "../../api.js";
import {
  CALENDAR_TOOL_CHIPS,
  DEFAULT_BOOKING_PREFS,
  appendToolSnippet,
  hasCalendarPromptBlock,
  injectCalendarPromptBlock,
} from "../../lib/calendarPrompt.js";

const DAYS_AHEAD_OPTIONS = [
  { value: 3, label: "Next 3 days" },
  { value: 5, label: "Next 5 days" },
  { value: 7, label: "Next 7 days" },
  { value: 10, label: "Next 10 days" },
  { value: 14, label: "Next 2 weeks" },
  { value: 21, label: "Next 3 weeks" },
];

const DURATION_OPTIONS = [
  { value: 15, label: "15 minutes" },
  { value: 20, label: "20 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 45, label: "45 minutes" },
  { value: 60, label: "60 minutes" },
];

const OFFER_OPTIONS = [
  { value: 2, label: "Offer 2 slots" },
  { value: 3, label: "Offer 3 slots" },
  { value: 4, label: "Offer 4 slots" },
  { value: 5, label: "Offer 5 slots" },
];

const TIMEZONE_OPTIONS = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

function formatHourLabel(hour) {
  const h = Number(hour);
  if (!Number.isFinite(h)) return String(hour);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:00 ${period}`;
}

function hourOptions(from, to) {
  const opts = [];
  for (let h = from; h <= to; h += 1) {
    opts.push({ value: h, label: formatHourLabel(h) });
  }
  return opts;
}

const START_HOUR_OPTIONS = hourOptions(6, 20);
const END_HOUR_OPTIONS = hourOptions(7, 22);

/**
 * SDR Agent panel — pick calendar, set slot window via dropdowns, enable tools in prompt.
 */
export function CalendarToolsPanel({ systemPrompt, onPromptChange, onCalendarContext }) {
  const [status, setStatus] = useState(null);
  const [calendars, setCalendars] = useState([]);
  const [prefs, setPrefs] = useState(DEFAULT_BOOKING_PREFS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [st, prefRes] = await Promise.all([
        calendarApi.status(),
        calendarApi.getBookingPrefs().catch(() => ({ prefs: DEFAULT_BOOKING_PREFS })),
      ]);
      setStatus(st);
      const nextPrefs = { ...DEFAULT_BOOKING_PREFS, ...(st.bookingPrefs || prefRes.prefs || {}) };
      setPrefs(nextPrefs);
      const conn = st.connections?.find((c) => c.provider === st.activeProvider);
      onCalendarContext?.({
        provider: st.activeProvider || "google",
        accountEmail: conn?.accountEmail,
        prefs: nextPrefs,
        timezone: nextPrefs.timezone,
      });
      if (st.activeProvider) {
        const list = await calendarApi.listCalendars(st.activeProvider).catch(() => ({ calendars: [] }));
        setCalendars(list.calendars || []);
      } else {
        setCalendars([]);
      }
    } catch (e) {
      setMsg(e.message || "Failed to load calendar");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeConn = status?.connections?.find((c) => c.provider === status?.activeProvider);
  const toolsOn = hasCalendarPromptBlock(systemPrompt);

  const setPref = (key, value) => {
    setPrefs((p) => {
      const next = { ...p, [key]: value };
      if (key === "dayStartHour" && Number(next.dayEndHour) <= Number(next.dayStartHour)) {
        next.dayEndHour = Math.min(22, Number(next.dayStartHour) + 1);
      }
      onCalendarContext?.({
        provider: status?.activeProvider || "google",
        accountEmail: activeConn?.accountEmail,
        prefs: next,
        timezone: next.timezone,
      });
      return next;
    });
  };

  const handleSelectCalendar = async (calendarId) => {
    if (!status?.activeProvider) return;
    setBusy("calendar");
    setMsg("");
    try {
      await calendarApi.selectCalendar(status.activeProvider, calendarId);
      await load();
      setMsg("Calendar selected for bookings.");
    } catch (e) {
      setMsg(e.message || "Could not select calendar");
    } finally {
      setBusy("");
    }
  };

  const applyPromptBlock = (savedPrefs = prefs) => {
    const next = injectCalendarPromptBlock(systemPrompt, {
      provider: status?.activeProvider || "google",
      accountEmail: activeConn?.accountEmail,
      prefs: savedPrefs,
      timezone: savedPrefs.timezone,
    });
    onPromptChange(next);
  };

  const handleSavePrefs = async () => {
    setBusy("prefs");
    setMsg("");
    try {
      const { prefs: saved } = await calendarApi.saveBookingPrefs(prefs);
      setPrefs({ ...DEFAULT_BOOKING_PREFS, ...saved });
      applyPromptBlock(saved);
      setMsg("Availability window saved and calendar tools block updated in the prompt. Remember to Save Configuration.");
    } catch (e) {
      setMsg(e.message || "Failed to save prefs");
    } finally {
      setBusy("");
    }
  };

  const handleEnableTools = () => {
    applyPromptBlock(prefs);
    setMsg("Calendar tools block added to the system prompt. Save Configuration to keep it.");
  };

  const handleChip = (chip) => {
    if (chip.id === "full_block") {
      handleEnableTools();
      return;
    }
    if (chip.snippet) {
      onPromptChange(appendToolSnippet(systemPrompt, chip.snippet));
      setMsg(`Added “${chip.label}” to the system prompt.`);
    }
  };

  if (loading) {
    return (
      <div style={S.card}>
        <div style={S.cardHeader}>Calendar booking</div>
        <div style={{ fontSize: 13, color: COLORS.textMuted }}>Loading calendar…</div>
      </div>
    );
  }

  const labelStyle = {
    fontSize: 12,
    fontWeight: 500,
    color: COLORS.textMuted,
    display: "block",
    marginBottom: 6,
  };

  const fieldWrap = { minWidth: 0 };

  return (
    <div style={S.card}>
      <div style={S.cardHeader}>
        <span>Calendar booking</span>
        {toolsOn ? (
          <span style={{ ...S.badge(COLORS.green), fontSize: 10 }}>Tools in prompt</span>
        ) : (
          <span style={{ ...S.badge(COLORS.orange), fontSize: 10 }}>Tools not in prompt</span>
        )}
      </div>

      <p style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 0, marginBottom: 16, lineHeight: 1.5 }}>
        Yes — the agent only gets live <code style={{ color: COLORS.text }}>check_availability</code> /{" "}
        <code style={{ color: COLORS.text }}>book_appointment</code> when the system prompt includes the
        calendar tools block. Use the button below (or the chips above the prompt). Slot dropdowns configure
        what those tools search — they run automatically during the call.
      </p>

      {!status?.activeProvider ? (
        <div style={{ padding: 14, borderRadius: 8, background: COLORS.surfaceAlt, fontSize: 13, color: COLORS.textMuted }}>
          Connect Google Calendar under <strong style={{ color: COLORS.text }}>SDR Setup</strong> or{" "}
          <strong style={{ color: COLORS.text }}>Connect Your Tech → Calendars</strong> first.
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle} htmlFor="cal-booking-calendar">
              Calendar for bookings
            </label>
            <select
              id="cal-booking-calendar"
              style={S.select}
              value={activeConn?.calendarId || (calendars[0]?.id ?? "primary")}
              disabled={busy === "calendar"}
              onChange={(e) => handleSelectCalendar(e.target.value)}
            >
              {calendars.length > 0 ? (
                calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.primary ? " (primary)" : ""}
                    {activeConn?.accountEmail && c.primary ? ` · ${activeConn.accountEmail}` : ""}
                  </option>
                ))
              ) : (
                <option value={activeConn?.calendarId || "primary"}>
                  Primary calendar
                  {activeConn?.accountEmail ? ` · ${activeConn.accountEmail}` : ""}
                </option>
              )}
            </select>
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              alignItems: "center",
              marginBottom: 18,
            }}
          >
            <button
              type="button"
              style={{ ...S.btn(toolsOn ? "secondary" : "primary"), padding: "10px 16px", fontSize: 13 }}
              onClick={handleEnableTools}
            >
              {toolsOn ? "Refresh tools block in prompt" : "Enable calendar tools in prompt"}
            </button>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {CALENDAR_TOOL_CHIPS.filter((c) => c.id !== "full_block").map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  title={chip.hint}
                  onClick={() => handleChip(chip)}
                  style={{
                    ...S.btn("ghost"),
                    padding: "6px 12px",
                    fontSize: 12,
                    borderRadius: 20,
                    cursor: "pointer",
                  }}
                >
                  @{chip.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 6 }}>Availability window</div>
          <p style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 0, marginBottom: 14, lineHeight: 1.45 }}>
            Used automatically when the agent checks availability. Pick frames from the dropdowns, then save.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: 14,
              marginBottom: 16,
            }}
          >
            <SelectField
              id="cal-days-ahead"
              label="Search window"
              style={fieldWrap}
              labelStyle={labelStyle}
              value={prefs.daysAhead}
              options={DAYS_AHEAD_OPTIONS}
              onChange={(v) => setPref("daysAhead", Number(v))}
            />
            <SelectField
              id="cal-duration"
              label="Meeting length"
              style={fieldWrap}
              labelStyle={labelStyle}
              value={prefs.durationMinutes}
              options={DURATION_OPTIONS}
              onChange={(v) => setPref("durationMinutes", Number(v))}
            />
            <SelectField
              id="cal-offer"
              label="Slots to offer"
              style={fieldWrap}
              labelStyle={labelStyle}
              value={prefs.offerCount}
              options={OFFER_OPTIONS}
              onChange={(v) => setPref("offerCount", Number(v))}
            />
            <SelectField
              id="cal-start"
              label="Business hours start"
              style={fieldWrap}
              labelStyle={labelStyle}
              value={prefs.dayStartHour}
              options={START_HOUR_OPTIONS}
              onChange={(v) => setPref("dayStartHour", Number(v))}
            />
            <SelectField
              id="cal-end"
              label="Business hours end"
              style={fieldWrap}
              labelStyle={labelStyle}
              value={prefs.dayEndHour}
              options={END_HOUR_OPTIONS.filter((o) => o.value > Number(prefs.dayStartHour || 0))}
              onChange={(v) => setPref("dayEndHour", Number(v))}
            />
            <div style={fieldWrap}>
              <label style={labelStyle} htmlFor="cal-timezone">
                Timezone
              </label>
              <select
                id="cal-timezone"
                style={S.select}
                value={
                  TIMEZONE_OPTIONS.includes(prefs.timezone)
                    ? prefs.timezone
                    : prefs.timezone || DEFAULT_BOOKING_PREFS.timezone
                }
                onChange={(e) => setPref("timezone", e.target.value)}
              >
                {!TIMEZONE_OPTIONS.includes(prefs.timezone) && prefs.timezone ? (
                  <option value={prefs.timezone}>{prefs.timezone}</option>
                ) : null}
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div
            style={{
              padding: "12px 14px",
              borderRadius: 8,
              background: COLORS.surfaceAlt,
              border: `1px solid ${COLORS.border}`,
              fontSize: 12,
              color: COLORS.textMuted,
              marginBottom: 14,
              lineHeight: 1.5,
            }}
          >
            Preview: search{" "}
            <strong style={{ color: COLORS.text }}>
              {DAYS_AHEAD_OPTIONS.find((o) => o.value === prefs.daysAhead)?.label || `${prefs.daysAhead} days`}
            </strong>
            , meetings{" "}
            <strong style={{ color: COLORS.text }}>{prefs.durationMinutes} min</strong>, hours{" "}
            <strong style={{ color: COLORS.text }}>
              {formatHourLabel(prefs.dayStartHour)} – {formatHourLabel(prefs.dayEndHour)}
            </strong>{" "}
            ({prefs.timezone?.replace(/_/g, " ")})
          </div>

          <button
            type="button"
            style={{ ...S.btn("secondary"), padding: "10px 16px", fontSize: 13 }}
            disabled={busy === "prefs"}
            onClick={handleSavePrefs}
          >
            {busy === "prefs" ? "Saving…" : "Save window + apply to prompt"}
          </button>
        </>
      )}

      {msg && (
        <div style={{ marginTop: 12, fontSize: 12, color: COLORS.textMuted, lineHeight: 1.45 }}>{msg}</div>
      )}
    </div>
  );
}

function SelectField({ id, label, value, options, onChange, style, labelStyle }) {
  const hasValue = options.some((o) => o.value === value);
  return (
    <div style={style}>
      <label style={labelStyle} htmlFor={id}>
        {label}
      </label>
      <select id={id} style={S.select} value={hasValue ? value : options[0]?.value} onChange={(e) => onChange(e.target.value)}>
        {!hasValue && value != null ? <option value={value}>{value}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
