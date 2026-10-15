import { useEffect, useState } from "react";
import { COLORS, S } from "../../theme.js";
import { leadsApi, settingsApi, calendarApi, sdrApi, auth, billingApi } from "../../api.js";
import { KnowledgeBaseInput } from "../sdr/KnowledgeBaseInput.jsx";
import { isBusinessDraftComplete, isAvailabilityDraftComplete } from "../../lib/onboarding.js";

const INDUSTRIES = [
  "HVAC",
  "Solar",
  "Roofing",
  "Plumbing",
  "Home Services",
  "Insurance",
  "Real Estate",
  "Other",
];

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "Pacific/Auckland",
  "Europe/London",
  "UTC",
];

function PrimaryButton({ children, onClick, disabled, busy }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      style={{
        ...S.btn("primary"),
        width: "100%",
        minHeight: 44,
        opacity: busy || disabled ? 0.7 : 1,
      }}
    >
      {busy ? "Working…" : children}
    </button>
  );
}

function GhostButton({ children, onClick }) {
  return (
    <button type="button" style={{ ...S.btn("ghost"), width: "100%", minHeight: 44, marginTop: 10 }} onClick={onClick}>
      {children}
    </button>
  );
}

/** Browser TTS spike for Levvi welcome (P4.2). */
export function LevviSpeakButton({ text }) {
  const [speaking, setSpeaking] = useState(false);
  const supported =
    typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined";

  const speak = () => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  };

  const stop = () => {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  };

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={speaking ? stop : speak}
      style={{
        ...S.btn("ghost"),
        marginTop: 12,
        minHeight: 40,
        fontSize: 13,
        border: `1px solid ${COLORS.border}`,
      }}
      aria-pressed={speaking}
    >
      {speaking ? "Stop voice" : "Hear Levvi (browser voice spike)"}
    </button>
  );
}

export function LevviWelcome({ user, onNext }) {
  const first = user?.firstName || "there";
  const line = `Hi ${first}. I'm Levvi, your setup guide for Catalyst. I'll walk you through connecting your business, channels, knowledge, and AI agent so you can launch in hours — not weeks.`;

  return (
    <div>
      <h3 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 8px" }}>Welcome to Catalyst</h3>
      <p style={{ color: COLORS.textMuted, fontSize: 14, margin: "0 0 16px", lineHeight: 1.55 }}>
        Hi {first} — I&apos;m <strong style={{ color: COLORS.orangeLight }}>Levvi</strong>, your
        guided setup assistant. We&apos;ll get your AI SDR live in a short, self-serve path.
      </p>
      <ul style={{ margin: "0 0 20px", paddingLeft: 18, color: COLORS.textMuted, fontSize: 13, lineHeight: 1.6 }}>
        <li>Business profile &amp; availability</li>
        <li>Connect phone, email, and calendar</li>
        <li>Import leads, configure the agent, upload knowledge</li>
      </ul>
      <PrimaryButton onClick={onNext}>Start with Levvi →</PrimaryButton>
      <LevviSpeakButton text={line} />
    </div>
  );
}

export function LevviExplain({ onNext }) {
  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>How Catalyst works</h3>
      <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "0 0 16px", lineHeight: 1.55 }}>
        One platform. One agent architecture. Different knowledge bases per vertical — not industry forks.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
        {[
          ["Account", "Your workspace, billing, and team"],
          ["Systems", "Phone, email, and calendar channels"],
          ["Knowledge", "Services, FAQs, pricing, and scripts"],
          ["Agent", "Prompts, templates, and outreach rules"],
          ["Leads", "Import and enroll contacts"],
          ["Launch", "Activate the AI SDR and go live"],
        ].map(([title, body]) => (
          <div
            key={title}
            style={{
              padding: "12px 14px",
              background: COLORS.surfaceAlt,
              borderRadius: 10,
              border: `1px solid ${COLORS.border}`,
            }}
          >
            <div style={{ fontWeight: 650, fontSize: 13, marginBottom: 2 }}>{title}</div>
            <div style={{ fontSize: 12, color: COLORS.textMuted }}>{body}</div>
          </div>
        ))}
      </div>
      <PrimaryButton onClick={onNext}>Got it — continue →</PrimaryButton>
    </div>
  );
}

export function LevviBusiness({ draft, onDraftChange, onNext }) {
  const [companyName, setCompanyName] = useState(draft.companyName || "");
  const [industry, setIndustry] = useState(draft.industry || "");
  const [website, setWebsite] = useState(draft.website || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    const next = { ...draft, companyName: companyName.trim(), industry: industry.trim(), website: website.trim() };
    if (!isBusinessDraftComplete(next)) {
      setErr("Company name and industry are required.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await settingsApi.patch({
        "org.companyName": next.companyName,
        "org.industry": next.industry,
        "org.website": next.website || "",
      }).catch(() => null);
      onDraftChange(next);
      onNext();
    } catch (e) {
      setErr(e.message || "Could not save business info");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px" }}>Business info</h3>
      <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "0 0 16px", lineHeight: 1.5 }}>
        Levvi uses this to personalize prompts and knowledge defaults. Industry differences live in KB — not custom screens.
      </p>
      <label style={{ display: "block", fontSize: 12, color: COLORS.textMuted, marginBottom: 6 }}>Company name</label>
      <input
        value={companyName}
        onChange={(e) => setCompanyName(e.target.value)}
        style={{ ...S.input, width: "100%", marginBottom: 12 }}
        placeholder="Acme Home Services"
      />
      <label style={{ display: "block", fontSize: 12, color: COLORS.textMuted, marginBottom: 6 }}>Industry</label>
      <select
        value={industry}
        onChange={(e) => setIndustry(e.target.value)}
        style={{ ...S.input, width: "100%", marginBottom: 12 }}
      >
        <option value="">Select…</option>
        {INDUSTRIES.map((i) => (
          <option key={i} value={i}>{i}</option>
        ))}
      </select>
      <label style={{ display: "block", fontSize: 12, color: COLORS.textMuted, marginBottom: 6 }}>Website (optional)</label>
      <input
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        style={{ ...S.input, width: "100%", marginBottom: 16 }}
        placeholder="https://"
      />
      {err && (
        <div role="alert" style={{ marginBottom: 12, padding: "9px 13px", borderRadius: 8, background: `${COLORS.red}20`, color: COLORS.red, fontSize: 12 }}>
          {err}
        </div>
      )}
      <PrimaryButton onClick={save} busy={busy}>Save &amp; continue →</PrimaryButton>
    </div>
  );
}

export function LevviAvailability({ draft, onDraftChange, onNext }) {
  const [timezone, setTimezone] = useState(draft.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York");
  const [weekdayStart, setWeekdayStart] = useState(draft.weekdayStart || "09:00");
  const [weekdayEnd, setWeekdayEnd] = useState(draft.weekdayEnd || "17:00");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const hourFrom = (t) => {
    const [h] = String(t).split(":");
    const n = parseInt(h, 10);
    return Number.isFinite(n) ? n : 9;
  };

  const save = async () => {
    const next = { ...draft, timezone, weekdayStart, weekdayEnd };
    if (!isAvailabilityDraftComplete(next)) {
      setErr("Timezone and weekday hours are required.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await calendarApi.saveBookingPrefs({
        timezone,
        dayStartHour: hourFrom(weekdayStart),
        dayEndHour: hourFrom(weekdayEnd) || 17,
        daysAhead: 5,
        durationMinutes: 30,
        maxSlots: 8,
        offerCount: 3,
      }).catch(() => null);
      await settingsApi.patch({
        "ai.outreach.quietHours": true,
        "compliance.quietHours": true,
      }).catch(() => null);
      onDraftChange(next);
      onNext();
    } catch (e) {
      setErr(e.message || "Could not save availability");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px" }}>Availability</h3>
      <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "0 0 16px", lineHeight: 1.5 }}>
        When should the agent offer appointments? Quiet hours stay on by default.
      </p>
      <label style={{ display: "block", fontSize: 12, color: COLORS.textMuted, marginBottom: 6 }}>Timezone</label>
      <select value={timezone} onChange={(e) => setTimezone(e.target.value)} style={{ ...S.input, width: "100%", marginBottom: 12 }}>
        {!TIMEZONES.includes(timezone) && <option value={timezone}>{timezone}</option>}
        {TIMEZONES.map((tz) => (
          <option key={tz} value={tz}>{tz}</option>
        ))}
      </select>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div>
          <label style={{ display: "block", fontSize: 12, color: COLORS.textMuted, marginBottom: 6 }}>Weekday start</label>
          <input type="time" value={weekdayStart} onChange={(e) => setWeekdayStart(e.target.value)} style={{ ...S.input, width: "100%" }} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 12, color: COLORS.textMuted, marginBottom: 6 }}>Weekday end</label>
          <input type="time" value={weekdayEnd} onChange={(e) => setWeekdayEnd(e.target.value)} style={{ ...S.input, width: "100%" }} />
        </div>
      </div>
      {err && (
        <div role="alert" style={{ marginBottom: 12, padding: "9px 13px", borderRadius: 8, background: `${COLORS.red}20`, color: COLORS.red, fontSize: 12 }}>
          {err}
        </div>
      )}
      <PrimaryButton onClick={save} busy={busy}>Save availability →</PrimaryButton>
    </div>
  );
}

export function LevviChannels({ onNext, onSkip }) {
  const [cal, setCal] = useState(null);
  const [gmail, setGmail] = useState(null);

  useEffect(() => {
    calendarApi.status().then(setCal).catch(() => setCal(null));
    import("../../api.js").then(({ gmailApi }) => {
      gmailApi.status().then(setGmail).catch(() => setGmail(null));
    });
  }, []);

  const connectCal = async (provider) => {
    try {
      const res = await calendarApi.startOAuth(provider);
      if (res?.url) window.location.href = res.url;
    } catch {
      /* ignore — user can skip */
    }
  };

  const connectGmail = async () => {
    try {
      const { gmailApi } = await import("../../api.js");
      const res = await gmailApi.startOAuth();
      if (res?.url) window.location.href = res.url;
    } catch {
      /* ignore */
    }
  };

  const calConnected = !!(cal?.connections?.length || cal?.activeProvider);
  const gmailConnected = !!(gmail?.connected || gmail?.email);

  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px" }}>Connect channels</h3>
      <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "0 0 16px", lineHeight: 1.5 }}>
        Optional now — connect what you can. You can finish these later in Settings.
      </p>
      {[
        {
          title: "Calendar",
          status: calConnected ? "Connected" : "Not connected",
          ok: calConnected,
          actions: (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" style={S.btn("ghost")} onClick={() => connectCal("google")}>Google</button>
              <button type="button" style={S.btn("ghost")} onClick={() => connectCal("outlook")}>Outlook</button>
            </div>
          ),
        },
        {
          title: "Email (Gmail)",
          status: gmailConnected ? "Connected" : "Not connected",
          ok: gmailConnected,
          actions: (
            <button type="button" style={S.btn("ghost")} onClick={connectGmail}>Connect Gmail</button>
          ),
        },
        {
          title: "Phone / SMS",
          status: "Configure in SDR settings",
          ok: false,
          actions: (
            <span style={{ fontSize: 12, color: COLORS.textDim }}>Twilio / calling is set up after launch</span>
          ),
        },
      ].map((row) => (
        <div
          key={row.title}
          style={{
            padding: "14px 16px",
            marginBottom: 10,
            background: COLORS.surfaceAlt,
            borderRadius: 10,
            border: `1px solid ${COLORS.border}`,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontWeight: 650, fontSize: 13 }}>{row.title}</span>
            <span style={{ fontSize: 11, color: row.ok ? COLORS.green : COLORS.textDim }}>{row.status}</span>
          </div>
          {row.actions}
        </div>
      ))}
      <PrimaryButton onClick={onNext}>Continue →</PrimaryButton>
      <GhostButton onClick={onSkip}>Skip for now</GhostButton>
    </div>
  );
}

function parseLeadLines(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out = [];
  for (const line of lines) {
    const parts = line.includes("\t") ? line.split("\t") : line.split(",");
    const [name = "", email = "", phone = ""] = parts.map((p) => p.trim());
    if (!name && !email && !phone) continue;
    const [firstName, ...rest] = name.split(/\s+/);
    out.push({
      firstName: firstName || "Lead",
      lastName: rest.join(" ") || "",
      email: email || undefined,
      phone: phone || undefined,
      source: "Levvi import",
      status: "new",
    });
  }
  return out;
}

export function LevviImportLeads({ draft, onDraftChange, onNext }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [existing, setExisting] = useState(null);

  useEffect(() => {
    leadsApi.list().then((list) => {
      const n = Array.isArray(list) ? list.length : list?.leads?.length || 0;
      setExisting(n);
    }).catch(() => setExisting(0));
  }, []);

  const importLeads = async () => {
    const rows = parseLeadLines(text);
    if (!rows.length) {
      setErr("Paste at least one line: Name, email, phone");
      return;
    }
    setBusy(true);
    setErr("");
    setMsg("");
    let ok = 0;
    try {
      for (const row of rows.slice(0, 50)) {
        await leadsApi.create(row);
        ok += 1;
      }
      setMsg(`Imported ${ok} lead${ok === 1 ? "" : "s"}.`);
      onDraftChange({ ...draft, leadsSkipped: false, leadsImported: ok });
      onNext();
    } catch (e) {
      setErr(e.message || "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const skip = () => {
    onDraftChange({ ...draft, leadsSkipped: true });
    onNext();
  };

  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px" }}>Import leads</h3>
      <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "0 0 12px", lineHeight: 1.5 }}>
        Paste CSV-style lines: <code style={{ color: COLORS.orangeLight }}>Name, email, phone</code>
        {existing != null ? ` · You already have ${existing} lead${existing === 1 ? "" : "s"}.` : ""}
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder={"Jane Doe, jane@example.com, +15551234567\nJohn Smith, john@example.com,"}
        style={{ ...S.input, width: "100%", marginBottom: 12, fontFamily: "ui-monospace, monospace", fontSize: 12 }}
      />
      {err && (
        <div role="alert" style={{ marginBottom: 12, padding: "9px 13px", borderRadius: 8, background: `${COLORS.red}20`, color: COLORS.red, fontSize: 12 }}>
          {err}
        </div>
      )}
      {msg && <p style={{ fontSize: 12, color: COLORS.green, marginBottom: 12 }}>{msg}</p>}
      <PrimaryButton onClick={importLeads} busy={busy} disabled={!text.trim()}>
        Import &amp; continue →
      </PrimaryButton>
      <GhostButton onClick={skip}>Skip — I&apos;ll add leads later</GhostButton>
    </div>
  );
}

export function LevviKnowledge({ draft, onDraftChange, onComplete }) {
  const [kb, setKb] = useState("");
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activate, setActivate] = useState(true);
  const [err, setErr] = useState("");
  const [billing, setBilling] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      sdrApi.getConfig().catch(() => null),
      billingApi.getStatus().catch(() => null),
    ]).then(([cfg, bill]) => {
      if (cancelled) return;
      setConfig(cfg);
      if (cfg?.knowledgeBase) setKb(cfg.knowledgeBase);
      setBilling(bill);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const finish = async ({ skipKb = false } = {}) => {
    setSaving(true);
    setErr("");
    try {
      if (!skipKb && config) {
        await sdrApi.saveConfig({
          systemPrompt: config.systemPrompt,
          smsTemplate: config.smsTemplate,
          emailSubject: config.emailSubject,
          emailBody: config.emailBody,
          dormantDays: config.dormantDays ?? 7,
          waitCallHrs: config.waitCallHrs ?? 2,
          waitSmsHrs: config.waitSmsHrs ?? 4,
          reEnrollDays: config.reEnrollDays ?? 30,
          knowledgeBase: kb || null,
        });
      } else if (skipKb) {
        onDraftChange({ ...draft, kbSkipped: true });
      }
      if (activate) {
        await sdrApi.setStatus(true);
      }
      await auth.completeOnboarding();
      setDone(true);
      onComplete?.({ activated: activate });
    } catch (e) {
      setErr(e.message || "Failed to finish onboarding");
    } finally {
      setSaving(false);
    }
  };

  const startCheckout = async () => {
    try {
      const origin = window.location.origin;
      const res = await billingApi.checkout(
        "monthly",
        `${origin}/?onboarding=1&checkout=success`,
        `${origin}/?onboarding=1&checkout=cancel`
      );
      if (res?.url) window.location.href = res.url;
    } catch (e) {
      setErr(e.message || "Checkout failed");
    }
  };

  if (loading) {
    return <p style={{ color: COLORS.textMuted, fontSize: 14 }}>Loading knowledge base…</p>;
  }

  if (done) {
    return (
      <div style={{ textAlign: "center", padding: "8px 0" }}>
        <h3 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 8px" }}>You&apos;re ready to launch</h3>
        <p style={{ color: COLORS.textMuted, fontSize: 13, margin: 0, lineHeight: 1.5 }}>
          Levvi setup is complete. Open the dashboard to manage leads and your AI SDR.
        </p>
      </div>
    );
  }

  const needsBilling = billing && !billing?.sdr?.isActive;

  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px" }}>Knowledge base &amp; launch</h3>
      <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "0 0 14px", lineHeight: 1.5 }}>
        Upload FAQs, services, and pricing. One agent × many KBs — industry specifics live here.
      </p>
      <KnowledgeBaseInput value={kb} onChange={setKb} bare />

      {needsBilling && (
        <div
          style={{
            marginTop: 16,
            marginBottom: 12,
            padding: "14px 16px",
            background: COLORS.surfaceAlt,
            borderRadius: 10,
            border: `1px solid ${COLORS.border}`,
          }}
        >
          <div style={{ fontWeight: 650, fontSize: 13, marginBottom: 6 }}>Activate billing</div>
          <p style={{ fontSize: 12, color: COLORS.textMuted, margin: "0 0 10px", lineHeight: 1.45 }}>
            {billing?.commercialPricing?.monthlyFeeEnabled
              ? `${billing.commercialPricing.monthlyFeeLabel} / mo`
              : "Monthly fee may be off for your account"}
          </p>
          <button type="button" style={{ ...S.btn("primary"), width: "100%" }} onClick={startCheckout}>
            Open Stripe checkout
          </button>
          <button
            type="button"
            style={{ ...S.btn("ghost"), width: "100%", marginTop: 8 }}
            onClick={() => setBilling({ ...billing, sdr: { ...(billing.sdr || {}), isActive: true } })}
          >
            Continue without checkout (dev)
          </button>
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "14px 16px",
          background: COLORS.surfaceAlt,
          borderRadius: 12,
          border: `1px solid ${COLORS.border}`,
          margin: "16px 0",
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Activate AI SDR now?</div>
          <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 2 }}>
            Start engaging enrolled leads after launch.
          </div>
        </div>
        <button
          type="button"
          aria-pressed={activate}
          onClick={() => setActivate((a) => !a)}
          style={{
            width: 48,
            height: 26,
            borderRadius: 13,
            border: "none",
            cursor: "pointer",
            background: activate ? COLORS.green : COLORS.border,
            position: "relative",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 3,
              left: activate ? 24 : 3,
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "#fff",
              pointerEvents: "none",
            }}
          />
        </button>
      </div>

      {err && (
        <div role="alert" style={{ marginBottom: 12, padding: "9px 13px", borderRadius: 8, background: `${COLORS.red}20`, color: COLORS.red, fontSize: 12 }}>
          {err}
        </div>
      )}

      <PrimaryButton onClick={() => finish({ skipKb: false })} busy={saving}>
        {activate ? "Save KB, activate & enter dashboard →" : "Save KB & enter dashboard →"}
      </PrimaryButton>
      <GhostButton onClick={() => finish({ skipKb: true })}>Skip KB for now &amp; finish</GhostButton>
    </div>
  );
}

// silence unused ref warning if tree-shaken — keep parse helper exported for tests
export { parseLeadLines };
