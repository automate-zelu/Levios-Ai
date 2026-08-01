import { useEffect, useState } from "react";
import { calendarApi, sdrApi } from "../../api.js";
import {
  hasCalendarPromptBlock,
  injectCalendarPromptBlock,
} from "../../lib/calendarPrompt.js";

const PROVIDERS = [
  {
    id: "google",
    integrationId: "google_calendar",
    name: "Google Calendar",
    icon: "📅",
    description: "Sync bookings to Google Workspace / Gmail calendar",
  },
];

/**
 * Account settings panel — connect Google Calendar and choose the active calendar.
 * Includes “Use this calendar in AI agent” to inject Vapi-style tool instructions.
 */
export default function CalendarConnections({ colors, styles: S }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [calendars, setCalendars] = useState([]);
  const [banner, setBanner] = useState(null);
  const [promptPresent, setPromptPresent] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, cfg] = await Promise.all([
        calendarApi.status(),
        sdrApi.getConfig().catch(() => null),
      ]);
      setStatus(data);
      setPromptPresent(hasCalendarPromptBlock(cfg?.systemPrompt));
    } catch (err) {
      setError(err.message || "Failed to load calendar status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const calendar = params.get("calendar");
    const provider = params.get("provider");
    const reason = params.get("reason");
    if (calendar === "connected") {
      setBanner({
        ok: true,
        text: `${provider === "outlook" ? "Outlook" : "Google"} calendar connected`,
      });
    } else if (calendar === "error") {
      setBanner({ ok: false, text: reason ? decodeURIComponent(reason) : "Calendar connection failed" });
    }
    if (calendar) {
      params.delete("calendar");
      params.delete("provider");
      params.delete("reason");
      params.delete("tab");
      const next = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${next ? `?${next}` : ""}`);
    }
    load();
  }, []);

  useEffect(() => {
    if (!status?.activeProvider) {
      setCalendars([]);
      return;
    }
    calendarApi
      .listCalendars(status.activeProvider)
      .then((res) => setCalendars(res.calendars || []))
      .catch(() => setCalendars([]));
  }, [status?.activeProvider, status?.connections?.length]);

  const connectionFor = (providerId) =>
    status?.connections?.find((c) => c.provider === providerId) || null;

  const handleConnect = async (providerId) => {
    setBusy(providerId);
    setError(null);
    try {
      const { url } = await calendarApi.startOAuth(providerId);
      window.location.href = url;
    } catch (err) {
      setError(err.message || "Could not start OAuth");
      setBusy(null);
    }
  };

  const handleDisconnect = async (providerId) => {
    setBusy(providerId);
    try {
      const data = await calendarApi.disconnect(providerId);
      setStatus(data);
      setBanner({ ok: true, text: "Calendar disconnected" });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const handleSetActive = async (providerId) => {
    setBusy(`active-${providerId}`);
    try {
      await calendarApi.setActive(providerId);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const handleSelectCalendar = async (calendarId) => {
    if (!status?.activeProvider) return;
    setBusy("calendar-select");
    try {
      await calendarApi.selectCalendar(status.activeProvider, calendarId);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const handleInjectPrompt = async () => {
    if (!status?.activeProvider) {
      setError("Connect and activate a calendar first");
      return;
    }
    setBusy("prompt");
    setError(null);
    try {
      const cfg = await sdrApi.getConfig();
      if (!cfg) {
        setError("Save your SDR Agent config first, then try again");
        return;
      }
      const conn = connectionFor(status.activeProvider);
      const nextPrompt = injectCalendarPromptBlock(cfg.systemPrompt, {
        provider: status.activeProvider,
        accountEmail: conn?.accountEmail,
      });
      await sdrApi.saveConfig({
        ...cfg,
        systemPrompt: nextPrompt,
      });
      setPromptPresent(true);
      setBanner({
        ok: true,
        text: promptPresent
          ? "AI agent calendar tools block updated"
          : "Calendar tools added to AI agent prompt",
      });
    } catch (err) {
      setError(err.message || "Failed to update agent prompt");
    } finally {
      setBusy(null);
    }
  };

  if (loading && !status) {
    return <div style={{ color: colors.textMuted, fontSize: 13 }}>Loading calendars…</div>;
  }

  return (
    <div>
      {banner && (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 8,
            background: banner.ok ? `${colors.green}15` : `${colors.red}15`,
            border: `1px solid ${banner.ok ? colors.green : colors.red}33`,
            fontSize: 13,
            color: banner.ok ? colors.green : colors.red,
            fontWeight: 600,
          }}
        >
          {banner.ok ? "✓ " : "✗ "}
          {banner.text}
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 16, fontSize: 13, color: colors.red }}>{error}</div>
      )}

      <p style={{ fontSize: 13, color: colors.textMuted, marginTop: 0, marginBottom: 16, lineHeight: 1.5 }}>
        Click Connect, sign in with Google, and approve calendar access.
        The voice agent can then check availability and book into this calendar.
      </p>

      <div style={{ display: "grid", gap: 12, marginBottom: 20 }}>
        {PROVIDERS.map((p) => {
          const conn = connectionFor(p.id);
          const isActive = status?.activeProvider === p.id;
          return (
            <div
              key={p.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                padding: 14,
                borderRadius: 10,
                border: `1px solid ${conn ? colors.green : colors.border}`,
                background: conn ? `${colors.green}08` : "transparent",
              }}
            >
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start", minWidth: 0 }}>
                <span style={{ fontSize: 26 }}>{p.icon}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {p.name}
                    {isActive && (
                      <span style={{ ...S.badge(colors.green), marginLeft: 8, fontSize: 10 }}>Active</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 4 }}>{p.description}</div>
                  {conn ? (
                    <div style={{ fontSize: 11, color: colors.green, fontWeight: 600 }}>
                      Connected{conn.accountEmail ? ` · ${conn.accountEmail}` : ""}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: colors.textDim }}>Not connected</div>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {conn && !isActive && (
                  <button
                    style={{ ...S.btn("ghost"), padding: "8px 12px", fontSize: 11 }}
                    disabled={!!busy}
                    onClick={() => handleSetActive(p.id)}
                  >
                    Use for bookings
                  </button>
                )}
                {conn ? (
                  <button
                    style={{ ...S.btn("ghost"), padding: "8px 12px", fontSize: 11 }}
                    disabled={busy === p.id}
                    onClick={() => handleDisconnect(p.id)}
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    style={{ ...S.btn("primary"), padding: "8px 14px", fontSize: 12 }}
                    disabled={busy === p.id}
                    onClick={() => handleConnect(p.id)}
                  >
                    {busy === p.id ? "Opening sign-in…" : `Connect ${p.name.split(" ").pop()}`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {status?.activeProvider && (
        <div style={{ ...S.card, marginTop: 0, marginBottom: 16 }}>
          <div style={S.cardHeader}>Calendar used for new bookings</div>
          <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 0 }}>
            Active provider: <strong style={{ color: colors.text }}>{status.activeProvider}</strong>
          </p>
          {calendars.length > 0 ? (
            <select
              style={{ ...S.select, width: "100%" }}
              value={connectionFor(status.activeProvider)?.calendarId || "primary"}
              disabled={busy === "calendar-select"}
              onChange={(e) => handleSelectCalendar(e.target.value)}
            >
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.primary ? " (primary)" : ""}
                </option>
              ))}
            </select>
          ) : (
            <div style={{ fontSize: 12, color: colors.textDim }}>Using default / primary calendar</div>
          )}
        </div>
      )}

      <div
        style={{
          padding: 16,
          borderRadius: 10,
          border: `1px solid ${colors.border}`,
          background: colors.surfaceAlt || "transparent",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 650, marginBottom: 6 }}>AI agent calendar tools</div>
        <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
          Add check_availability and book_appointment instructions to the SDR voice agent prompt
          (same pattern as a Vapi single-prompt agent with tools).
        </p>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            style={{ ...S.btn("primary"), padding: "10px 16px", fontSize: 12 }}
            disabled={!status?.activeProvider || busy === "prompt"}
            onClick={handleInjectPrompt}
          >
            {busy === "prompt"
              ? "Updating prompt…"
              : promptPresent
                ? "Refresh calendar tools in AI prompt"
                : "Use this calendar in AI agent"}
          </button>
          {promptPresent && (
            <span style={{ fontSize: 12, color: colors.green, fontWeight: 600 }}>
              ✓ Calendar tools present in prompt
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
