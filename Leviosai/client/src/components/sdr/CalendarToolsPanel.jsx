import { useEffect, useState } from "react";
import { COLORS, S } from "../../theme.js";
import { calendarApi, sdrApi } from "../../api.js";
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
 * Calendar booking rules — which calendar, slot window, and whether live tools are in the prompt.
 * Use persistPrompt on SDR Setup so this page can save the agent prompt itself.
 */
export function CalendarToolsPanel({
  systemPrompt,
  onPromptChange,
  onCalendarContext,
  persistPrompt = false,
  embedded = false,
}) {
  const [status, setStatus] = useState(null);
  const [calendars, setCalendars] = useState([]);
  const [prefs, setPrefs] = useState(DEFAULT_BOOKING_PREFS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [prompt, setPrompt] = useState(systemPrompt || "");

  const load = async () => {
    setLoading(true);
    try {
      const [st, prefRes, cfg] = await Promise.all([
        calendarApi.status(),
        calendarApi.getBookingPrefs().catch(() => ({ prefs: DEFAULT_BOOKING_PREFS })),
        persistPrompt ? sdrApi.getConfig().catch(() => null) : Promise.resolve(null),
      ]);
      setStatus(st);
      if (persistPrompt) setPrompt(cfg?.systemPrompt || "");
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

  useEffect(() => {
    if (!persistPrompt) setPrompt(systemPrompt || "");
  }, [systemPrompt, persistPrompt]);

  const activeConn = status?.connections?.find((c) => c.provider === status?.activeProvider);
  const currentPrompt = persistPrompt ? prompt : systemPrompt;
  const toolsOn = hasCalendarPromptBlock(currentPrompt);

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

  const applyPromptBlock = async (savedPrefs = prefs, extraSnippet = null) => {
    let next = injectCalendarPromptBlock(currentPrompt, {
      provider: status?.activeProvider || "google",
      accountEmail: activeConn?.accountEmail,
      prefs: savedPrefs,
      timezone: savedPrefs.timezone,
    });
    if (extraSnippet) next = appendToolSnippet(next, extraSnippet);

    if (persistPrompt) {
      const cfg = await sdrApi.getConfig();
      if (!cfg) throw new Error("Save your SDR Agent config first, then enable calendar tools.");
      await sdrApi.saveConfig({ ...cfg, systemPrompt: next });
      setPrompt(next);
    } else {
      onPromptChange?.(next);
    }
    return next;
  };

  const handleSavePrefs = async () => {
    setBusy("prefs");
    setMsg("");
    try {
      const { prefs: saved } = await calendarApi.saveBookingPrefs(prefs);
      setPrefs({ ...DEFAULT_BOOKING_PREFS, ...saved });
      await applyPromptBlock(saved);
      setMsg(
        persistPrompt
          ? "Availability window saved and applied to the agent prompt."
          : "Window saved and prompt updated. Click Save Configuration on SDR Agent to keep it."
      );
    } catch (e) {
      setMsg(e.message || "Failed to save prefs");
    } finally {
      setBusy("");
    }
  };

  const handleEnableTools = async () => {
    setBusy("prompt");
    setMsg("");
    try {
      await applyPromptBlock(prefs);
      setMsg(
        persistPrompt
          ? toolsOn
            ? "Calendar tools in the agent prompt were refreshed."
            : "Calendar tools added to the agent prompt."
          : "Calendar tools added to the prompt. Click Save Configuration on SDR Agent to keep it."
      );
    } catch (e) {
      setMsg(e.message || "Could not update prompt");
    } finally {
      setBusy("");
    }
  };

  const handleChip = async (chip) => {
    if (chip.id === "full_block") {
      await handleEnableTools();
      return;
    }
    if (!chip.snippet) return;
    setBusy("prompt");
    setMsg("");
    try {
      if (persistPrompt) {
        const cfg = await sdrApi.getConfig();
        if (!cfg) throw new Error("Save your SDR Agent config first.");
        const next = appendToolSnippet(cfg.systemPrompt || "", chip.snippet);
        await sdrApi.saveConfig({ ...cfg, systemPrompt: next });
        setPrompt(next);
      } else {
        onPromptChange?.(appendToolSnippet(currentPrompt, chip.snippet));
      }
      setMsg(`Added “${chip.label}” to the agent prompt.`);
    } catch (e) {
      setMsg(e.message || "Could not update prompt");
    } finally {
      setBusy("");
    }
  };

  if (loading) {
    return (
      <div style={embedded ? undefined : S.card}>
        <div style={{ fontSize: 13, color: COLORS.textMuted }}>Loading booking settings…</div>
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

  const body = (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 650 }}>Booking rules</div>
        {toolsOn ? (
          <span style={{ ...S.badge(COLORS.green), fontSize: 10 }}>Live tools in prompt</span>
        ) : (
          <span style={{ ...S.badge(COLORS.orange), fontSize: 10 }}>Tools not in prompt</span>
        )}
      </div>
      <p style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 0, marginBottom: 16, lineHeight: 1.5 }}>
        The agent can check availability and book only after calendar tools are in the system prompt.
        These dropdowns set the window those tools search during a call.
      </p>

      {!status?.activeProvider ? (
        <div style={{ padding: 14, borderRadius: 8, background: COLORS.surfaceAlt, fontSize: 13, color: COLORS.textMuted }}>
          Connect Google Calendar above, then return here to choose a calendar and booking window.
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
              marginBottom: 20,
            }}
          >
            <button
              type="button"
              style={{ ...S.btn(toolsOn ? "secondary" : "primary"), padding: "10px 16px", fontSize: 13 }}
              disabled={busy === "prompt"}
              onClick={handleEnableTools}
            >
              {busy === "prompt"
                ? "Updating…"
                : toolsOn
                  ? "Refresh tools in prompt"
                  : "Enable calendar tools in prompt"}
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
            Used when the agent checks availability. Save to apply.
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
            {DAYS_AHEAD_OPTIONS.find((o) => o.value === prefs.daysAhead)?.label || `${prefs.daysAhead} days`}
            {" · "}
            {prefs.durationMinutes} min meetings
            {" · "}
            {formatHourLabel(prefs.dayStartHour)} – {formatHourLabel(prefs.dayEndHour)}
            {" · "}
            {prefs.timezone?.replace(/_/g, " ")}
          </div>

          <button
            type="button"
            style={{ ...S.btn("secondary"), padding: "10px 16px", fontSize: 13 }}
            disabled={busy === "prefs"}
            onClick={handleSavePrefs}
          >
            {busy === "prefs" ? "Saving…" : persistPrompt ? "Save booking window" : "Save window + apply to prompt"}
          </button>
        </>
      )}

      {msg && (
        <div style={{ marginTop: 12, fontSize: 12, color: COLORS.textMuted, lineHeight: 1.45 }}>{msg}</div>
      )}
    </>
  );

  if (embedded) return <div>{body}</div>;
  return <div style={S.card}>{body}</div>;
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
