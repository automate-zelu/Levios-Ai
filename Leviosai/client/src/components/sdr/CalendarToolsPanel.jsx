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

/**
 * SDR Agent panel — pick calendar, set slot window, insert tool chips into the system prompt
 * (same chip UX pattern as SMS/email template variables).
 */
export function CalendarToolsPanel({ systemPrompt, onPromptChange }) {
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
      setPrefs({ ...DEFAULT_BOOKING_PREFS, ...(st.bookingPrefs || prefRes.prefs || {}) });
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
  }, []);

  const activeConn = status?.connections?.find((c) => c.provider === status?.activeProvider);

  const setPref = (key, value) => {
    setPrefs((p) => ({ ...p, [key]: value }));
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

  const handleSavePrefs = async () => {
    setBusy("prefs");
    setMsg("");
    try {
      const { prefs: saved } = await calendarApi.saveBookingPrefs(prefs);
      setPrefs({ ...DEFAULT_BOOKING_PREFS, ...saved });
      // Refresh prompt block so agent instructions match saved window
      const next = injectCalendarPromptBlock(systemPrompt, {
        provider: status?.activeProvider || "google",
        accountEmail: activeConn?.accountEmail,
        prefs: saved,
        timezone: saved.timezone,
      });
      onPromptChange(next);
      setMsg("Booking window saved and applied to AI prompt.");
    } catch (e) {
      setMsg(e.message || "Failed to save prefs");
    } finally {
      setBusy("");
    }
  };

  const handleChip = (chip) => {
    if (chip.id === "full_block") {
      const next = injectCalendarPromptBlock(systemPrompt, {
        provider: status?.activeProvider || "google",
        accountEmail: activeConn?.accountEmail,
        prefs,
        timezone: prefs.timezone,
      });
      onPromptChange(next);
      setMsg("Full calendar tools block added to system prompt.");
      return;
    }
    if (chip.snippet) {
      onPromptChange(appendToolSnippet(systemPrompt, chip.snippet));
      setMsg(`Added “${chip.label}” instruction to system prompt.`);
    }
  };

  if (loading) {
    return (
      <div style={S.card}>
        <div style={S.cardHeader}>Calendar tools</div>
        <div style={{ fontSize: 13, color: COLORS.textMuted }}>Loading calendar…</div>
      </div>
    );
  }

  return (
    <div style={S.card}>
      <div style={S.cardHeader}>
        <span>Calendar tools (single-prompt agent)</span>
        {hasCalendarPromptBlock(systemPrompt) && (
          <span style={{ ...S.badge(COLORS.green), fontSize: 10 }}>In prompt</span>
        )}
      </div>
      <p style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 0, marginBottom: 14, lineHeight: 1.5 }}>
        Same idea as template chips below — click a chip to tell the voice agent which tools to use and when.
        Slot settings are applied automatically by the tools (the agent does not invent times).
      </p>

      {!status?.activeProvider ? (
        <div style={{ padding: 14, borderRadius: 8, background: COLORS.surfaceAlt, fontSize: 13, color: COLORS.textMuted }}>
          Connect Google Calendar under <strong style={{ color: COLORS.text }}>SDR Setup</strong> or{" "}
          <strong style={{ color: COLORS.text }}>Connect Your Tech → Calendars</strong> first.
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>
              Calendar for bookings
            </label>
            {calendars.length > 0 ? (
              <select
                style={{ ...S.select, width: "100%" }}
                value={activeConn?.calendarId || "primary"}
                disabled={busy === "calendar"}
                onChange={(e) => handleSelectCalendar(e.target.value)}
              >
                {calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.primary ? " (primary)" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ fontSize: 12, color: COLORS.textDim }}>
                Using {status.activeProvider}
                {activeConn?.accountEmail ? ` · ${activeConn.accountEmail}` : ""} · default calendar
              </div>
            )}
          </div>

          <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 8 }}>
            Insert into AI system prompt
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
            {CALENDAR_TOOL_CHIPS.map((chip) => (
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
                }}
              >
                @{chip.label}
              </button>
            ))}
          </div>

          <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 10 }}>Availability window</div>
          <p style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 0, marginBottom: 12 }}>
            Tools use these automatically when the agent calls check_availability. Save to refresh the prompt block.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12, marginBottom: 14 }}>
            <Field label="Days ahead" type="number" value={prefs.daysAhead} onChange={(v) => setPref("daysAhead", Number(v))} />
            <Field label="Meeting length (min)" type="number" value={prefs.durationMinutes} onChange={(v) => setPref("durationMinutes", Number(v))} />
            <Field label="Offer up to N slots" type="number" value={prefs.offerCount} onChange={(v) => setPref("offerCount", Number(v))} />
            <Field label="Day start hour" type="number" value={prefs.dayStartHour} onChange={(v) => setPref("dayStartHour", Number(v))} />
            <Field label="Day end hour" type="number" value={prefs.dayEndHour} onChange={(v) => setPref("dayEndHour", Number(v))} />
            <div>
              <label style={{ fontSize: 11, color: COLORS.textMuted, display: "block", marginBottom: 4 }}>Timezone</label>
              <input
                style={S.input}
                value={prefs.timezone}
                onChange={(e) => setPref("timezone", e.target.value)}
                placeholder="America/New_York"
              />
            </div>
          </div>

          <button
            type="button"
            style={{ ...S.btn("secondary"), padding: "8px 14px", fontSize: 12 }}
            disabled={busy === "prefs"}
            onClick={handleSavePrefs}
          >
            {busy === "prefs" ? "Saving…" : "Save window + apply to prompt"}
          </button>
        </>
      )}

      {msg && (
        <div style={{ marginTop: 12, fontSize: 12, color: COLORS.textMuted }}>{msg}</div>
      )}
    </div>
  );
}

function Field({ label, type, value, onChange }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: COLORS.textMuted, display: "block", marginBottom: 4 }}>{label}</label>
      <input
        type={type}
        style={S.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
