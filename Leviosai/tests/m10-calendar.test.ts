/**
 * Module 10 — Google / Outlook calendar helpers
 * Run: npx tsx --test tests/m10-calendar.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveActiveProvider,
  parseScheduledAt,
  appointmentEndAt,
  defaultAppointmentTitle,
  buildCalendarEventPayload,
  shouldCreateAppointmentFromOutcome,
  canSelectActiveProvider,
  publicConnectionStatus,
  DEFAULT_APPOINTMENT_DURATION_MINUTES,
  ACTIVE_CALENDAR_SETTING_KEY,
} from "../lib/calendar/booking-helpers.js";
import {
  isCalendarProvider,
  CALENDAR_PROVIDERS,
} from "../lib/calendar/types.js";
import {
  buildAuthorizeUrl,
  getAppBaseUrl,
  oauthCallbackUrl,
  parseProviderParam,
  providerFromIntegrationId,
  integrationIdForProvider,
  getProviderClientCredentials,
} from "../lib/calendar/oauth-config.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("M10 provider types", () => {
  it("accepts google and outlook only", () => {
    assert.equal(isCalendarProvider("google"), true);
    assert.equal(isCalendarProvider("outlook"), true);
    assert.equal(isCalendarProvider("calcom"), false);
    assert.deepEqual(CALENDAR_PROVIDERS, ["google", "outlook"]);
  });

  it("maps Connect Tech integration ids", () => {
    assert.equal(providerFromIntegrationId("google_calendar"), "google");
    assert.equal(providerFromIntegrationId("outlook"), "outlook");
    assert.equal(providerFromIntegrationId("hubspot"), null);
    assert.equal(integrationIdForProvider("google"), "google_calendar");
    assert.equal(parseProviderParam("google_calendar"), "google");
    assert.equal(parseProviderParam("outlook"), "outlook");
    assert.equal(parseProviderParam("nope"), null);
  });
});

describe("M10 active provider resolution", () => {
  it("returns null when nothing connected", () => {
    assert.equal(resolveActiveProvider({ activeSetting: "google", connected: [] }), null);
  });

  it("honors active setting when connected", () => {
    assert.equal(
      resolveActiveProvider({ activeSetting: "outlook", connected: ["google", "outlook"] }),
      "outlook"
    );
  });

  it("falls back when setting points at disconnected provider", () => {
    assert.equal(
      resolveActiveProvider({ activeSetting: "outlook", connected: ["google"] }),
      "google"
    );
  });

  it("canSelectActiveProvider validates membership", () => {
    assert.equal(canSelectActiveProvider(null, ["google"]), true);
    assert.equal(canSelectActiveProvider("google", ["google"]), true);
    assert.equal(canSelectActiveProvider("outlook", ["google"]), false);
  });

  it("exposes setting key constant", () => {
    assert.equal(ACTIVE_CALENDAR_SETTING_KEY, "calendar.activeProvider");
  });
});

describe("M10 schedule helpers", () => {
  it("parses scheduledAt values", () => {
    assert.equal(parseScheduledAt(null), null);
    assert.equal(parseScheduledAt("not-a-date"), null);
    const d = parseScheduledAt("2026-08-01T15:00:00.000Z");
    assert.ok(d instanceof Date);
    assert.equal(d!.toISOString(), "2026-08-01T15:00:00.000Z");
  });

  it("computes end time with default duration", () => {
    const start = new Date("2026-08-01T15:00:00.000Z");
    const end = appointmentEndAt(start);
    assert.equal(end.getTime() - start.getTime(), DEFAULT_APPOINTMENT_DURATION_MINUTES * 60_000);
  });

  it("builds event payload", () => {
    const start = new Date("2026-08-01T15:00:00.000Z");
    const event = buildCalendarEventPayload({
      title: "Solar consult",
      scheduledAt: start,
      durationMinutes: 45,
      attendeeEmail: "lead@example.com",
      timezone: "America/Chicago",
    });
    assert.equal(event.title, "Solar consult");
    assert.equal(event.attendeeEmail, "lead@example.com");
    assert.equal(event.end.getTime() - event.start.getTime(), 45 * 60_000);
    assert.equal(event.timezone, "America/Chicago");
  });

  it("defaults appointment titles", () => {
    assert.equal(defaultAppointmentTitle({}), "Consultation appointment");
    assert.equal(defaultAppointmentTitle({ leadName: "Ada Lovelace" }), "Consultation — Ada Lovelace");
    assert.equal(defaultAppointmentTitle({ title: "Site survey", leadName: "X" }), "Site survey");
  });

  it("only creates appointments for booked outcomes", () => {
    assert.equal(shouldCreateAppointmentFromOutcome("booked"), true);
    assert.equal(shouldCreateAppointmentFromOutcome("qualified"), false);
  });

  it("maps public connection status", () => {
    const pub = publicConnectionStatus([
      {
        provider: "google",
        accountEmail: "a@b.com",
        calendarId: "primary",
        connectedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      { provider: "calcom", accountEmail: null, calendarId: null, connectedAt: null },
    ]);
    assert.equal(pub.length, 1);
    assert.equal(pub[0].provider, "google");
    assert.equal(pub[0].accountEmail, "a@b.com");
  });
});

describe("M10 OAuth URL builders", () => {
  it("builds google authorize URL when credentials present", () => {
    const prevId = process.env.GOOGLE_CLIENT_ID;
    const prevSecret = process.env.GOOGLE_CLIENT_SECRET;
    process.env.GOOGLE_CLIENT_ID = "test-google-client";
    process.env.GOOGLE_CLIENT_SECRET = "test-google-secret";
    try {
      const url = buildAuthorizeUrl("google", "state-token");
      assert.match(url, /accounts\.google\.com/);
      assert.match(url, /client_id=test-google-client/);
      assert.match(url, /state=state-token/);
      assert.match(url, /access_type=offline/);
      assert.match(url, /calendar\.events/);
      assert.ok(getProviderClientCredentials("google").configured);
      assert.match(oauthCallbackUrl("google"), /\/api\/calendar\/oauth\/google\/callback$/);
      assert.ok(getAppBaseUrl().length > 0);
    } finally {
      if (prevId === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = prevId;
      if (prevSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
      else process.env.GOOGLE_CLIENT_SECRET = prevSecret;
    }
  });

  it("builds outlook authorize URL when credentials present", () => {
    const prevId = process.env.MICROSOFT_CLIENT_ID;
    const prevSecret = process.env.MICROSOFT_CLIENT_SECRET;
    process.env.MICROSOFT_CLIENT_ID = "test-ms-client";
    process.env.MICROSOFT_CLIENT_SECRET = "test-ms-secret";
    try {
      const url = buildAuthorizeUrl("outlook", "ms-state");
      assert.match(url, /login\.microsoftonline\.com/);
      assert.match(url, /client_id=test-ms-client/);
      assert.match(url, /Calendars\.ReadWrite/);
    } finally {
      if (prevId === undefined) delete process.env.MICROSOFT_CLIENT_ID;
      else process.env.MICROSOFT_CLIENT_ID = prevId;
      if (prevSecret === undefined) delete process.env.MICROSOFT_CLIENT_SECRET;
      else process.env.MICROSOFT_CLIENT_SECRET = prevSecret;
    }
  });

  it("throws when credentials missing", () => {
    const prevId = process.env.GOOGLE_CLIENT_ID;
    const prevSecret = process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    try {
      assert.throws(() => buildAuthorizeUrl("google", "x"), /not configured/);
    } finally {
      if (prevId !== undefined) process.env.GOOGLE_CLIENT_ID = prevId;
      if (prevSecret !== undefined) process.env.GOOGLE_CLIENT_SECRET = prevSecret;
    }
  });
});

describe("M10 wiring present in repo", () => {
  it("ships calendar routes, service, and UI", () => {
    const files = [
      "routes/calendar.ts",
      "lib/calendar/service.ts",
      "lib/calendar/providers.ts",
      "lib/calendar/tokens.ts",
      "client/src/components/calendar/CalendarConnections.jsx",
    ];
    for (const f of files) {
      assert.ok(existsSync(path.join(root, f)), `missing ${f}`);
    }
  });

  it("registers calendar routes in server.ts", () => {
    const src = readFileSync(path.join(root, "server.ts"), "utf8");
    assert.match(src, /calendarRoutes/);
    assert.match(src, /routes\/calendar/);
  });

  it("stores bookedScheduledAt from call outcome analysis", () => {
    const pipeline = readFileSync(path.join(root, "lib/calling/audio-pipeline.ts"), "utf8");
    assert.match(pipeline, /bookedScheduledAt/);
    const agent = readFileSync(path.join(root, "lib/calling/langchain-agent.ts"), "utf8");
    assert.match(agent, /scheduledAt/);
  });

  it("books appointment after SDR booked outcome", () => {
    const call = readFileSync(path.join(root, "routes/call.ts"), "utf8");
    assert.match(call, /bookAppointmentWithCalendar/);
  });

  it("wires live calendar tools into the call agent", () => {
    const agent = readFileSync(path.join(root, "lib/calling/langchain-agent.ts"), "utf8");
    assert.match(agent, /check_availability/);
    assert.match(agent, /book_appointment/);
  });

  it("exposes availability route", () => {
    const src = readFileSync(path.join(root, "routes/calendar.ts"), "utf8");
    assert.match(src, /\/api\/calendar\/availability/);
  });
});

describe("M10 prompt block + open slots", () => {
  it("injects calendar tools block idempotently", async () => {
    const {
      injectCalendarPromptBlock,
      hasCalendarPromptBlock,
      CALENDAR_PROMPT_MARKER,
    } = await import("../lib/calendar/prompt-block.js");
    const once = injectCalendarPromptBlock("You are an SDR.");
    assert.equal(hasCalendarPromptBlock(once), true);
    assert.match(once, /check_availability/);
    const twice = injectCalendarPromptBlock(once, { accountEmail: "ops@example.com" });
    assert.equal(twice.split(CALENDAR_PROMPT_MARKER).length - 1, 1);
    assert.match(twice, /ops@example\.com/);
  });

  it("computes open slots around busy intervals", async () => {
    const { computeOpenSlots } = await import("../lib/calendar/providers.js");
    // Use a Monday far enough in the future so "now + 5m" does not wipe the window.
    const timeMin = new Date("2030-01-07T12:00:00.000Z"); // Mon
    const timeMax = new Date("2030-01-09T23:00:00.000Z");
    const busyStart = new Date("2030-01-07T14:00:00.000Z");
    const busyEnd = new Date("2030-01-07T15:00:00.000Z");
    const slots = computeOpenSlots({
      timeMin,
      timeMax,
      busy: [{ start: busyStart, end: busyEnd }],
      durationMinutes: 30,
      timezone: "UTC",
      dayStartHour: 9,
      dayEndHour: 17,
      maxSlots: 5,
    });
    assert.ok(slots.length > 0);
    for (const s of slots) {
      assert.ok(!(s.start < busyEnd && s.end > busyStart), "slot overlaps busy");
    }
  });

  it("humanizes Google Calendar API disabled errors", async () => {
    const { humanizeCalendarApiError } = await import("../lib/calendar/service.js");
    const msg = humanizeCalendarApiError(
      "Google Calendar API has not been used in project 123 before or it is disabled. Enable it by visiting https://example.com"
    );
    assert.match(msg, /Google Calendar API is disabled/);
    assert.match(msg, /console\.cloud\.google\.com/);
  });

  it("normalizes booking prefs", async () => {
    const { normalizeCalendarBookingPrefs, DEFAULT_CALENDAR_BOOKING_PREFS } = await import(
      "../lib/calendar/booking-helpers.js"
    );
    const prefs = normalizeCalendarBookingPrefs({ daysAhead: 99, offerCount: 0, timezone: "Asia/Karachi" });
    assert.equal(prefs.daysAhead, 21);
    assert.equal(prefs.offerCount, 1);
    assert.equal(prefs.timezone, "Asia/Karachi");
    assert.equal(prefs.durationMinutes, DEFAULT_CALENDAR_BOOKING_PREFS.durationMinutes);
  });

  it("exposes booking-prefs routes", () => {
    const src = readFileSync(path.join(root, "routes/calendar.ts"), "utf8");
    assert.match(src, /\/api\/calendar\/booking-prefs/);
  });

  it("ships CalendarToolsPanel on SDR Setup", () => {
    assert.ok(existsSync(path.join(root, "client/src/components/sdr/CalendarToolsPanel.jsx")));
    const page = readFileSync(path.join(root, "client/src/pages/SDRSetupPage.jsx"), "utf8");
    assert.match(page, /CalendarToolsPanel/);
  });
});
