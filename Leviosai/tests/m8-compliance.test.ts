/**
 * Module 8 — TCPA compliance: quiet hours (lead TZ), DNC parse, frequency
 * Run: npx tsx --test tests/m8-compliance.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePhoneDigits,
  inferTimezoneFromPhone,
  resolveLeadTimezone,
  getLocalHour,
  isWithinCallingHours,
  evaluateQuietHours,
  isFrequencyLimitReached,
  parseBlacklistResponse,
  lookupDnc,
  DEFAULT_LEAD_TIMEZONE,
  CALLING_HOURS,
  MAX_CALL_ATTEMPTS_PER_WEEK,
} from "../lib/compliance.js";

describe("M8 phone + timezone", () => {
  it("normalizes NANP phones", () => {
    assert.equal(normalizePhoneDigits("+1 (310) 555-0199"), "3105550199");
    assert.equal(normalizePhoneDigits("3105550199"), "3105550199");
    assert.equal(normalizePhoneDigits(null), null);
  });

  it("infers timezone from area code", () => {
    assert.equal(inferTimezoneFromPhone("3105550199"), "America/Los_Angeles");
    assert.equal(inferTimezoneFromPhone("2125550199"), "America/New_York");
    assert.equal(inferTimezoneFromPhone("3125550199"), "America/Chicago");
    assert.equal(inferTimezoneFromPhone("9995550199"), DEFAULT_LEAD_TIMEZONE);
  });

  it("prefers explicit lead.timezone when valid", () => {
    assert.equal(
      resolveLeadTimezone({ timezone: "America/Denver", phone: "3105550199" }),
      "America/Denver"
    );
    assert.equal(
      resolveLeadTimezone({ timezone: "Not/AZone", phone: "3105550199" }),
      "America/Los_Angeles"
    );
  });
});

describe("M8 quiet hours (lead local time)", () => {
  it("uses 8–21 window from reactor config", () => {
    assert.equal(CALLING_HOURS.start, 8);
    assert.equal(CALLING_HOURS.end, 21);
    assert.equal(isWithinCallingHours(8), true);
    assert.equal(isWithinCallingHours(20), true);
    assert.equal(isWithinCallingHours(7), false);
    assert.equal(isWithinCallingHours(21), false);
  });

  it("evaluates quiet hours in lead timezone not server UTC", () => {
    // 2026-07-30 15:00 UTC = 8:00 America/Los_Angeles (PDT, UTC-7)
    const morningPT = new Date("2026-07-30T15:00:00.000Z");
    assert.equal(getLocalHour(morningPT, "America/Los_Angeles"), 8);
    const ok = evaluateQuietHours(
      { phone: "3105550199", timezone: "America/Los_Angeles" },
      morningPT
    );
    assert.equal(ok.allowed, true);

    // 2026-07-30 06:00 UTC = 23:00 previous evening PT — outside window
    const latePT = new Date("2026-07-30T06:00:00.000Z");
    assert.equal(getLocalHour(latePT, "America/Los_Angeles"), 23);
    const blocked = evaluateQuietHours(
      { phone: "3105550199", timezone: "America/Los_Angeles" },
      latePT
    );
    assert.equal(blocked.allowed, false);
    if (!blocked.allowed) {
      assert.equal(blocked.reason, "quiet_hours");
      assert.ok(blocked.nextAllowedAt instanceof Date);
    }
  });
});

describe("M8 call frequency", () => {
  it("caps at 3 attempts per week", () => {
    assert.equal(MAX_CALL_ATTEMPTS_PER_WEEK, 3);
    assert.equal(isFrequencyLimitReached(2), false);
    assert.equal(isFrequencyLimitReached(3), true);
    assert.equal(isFrequencyLimitReached(5), true);
  });
});

describe("M8 Blacklist Alliance DNC", () => {
  it("parses common API response shapes", () => {
    assert.equal(parseBlacklistResponse({ message: "Good" }), true);
    assert.equal(parseBlacklistResponse({ status: "clean" }), true);
    assert.equal(parseBlacklistResponse({ status: "blacklisted" }), false);
    assert.equal(parseBlacklistResponse({ blacklisted: true }), false);
    assert.equal(parseBlacklistResponse({ results: [{ phone: "3105550199" }] }), false);
  });

  it("uses lead.dncClean when API key missing", async () => {
    const prev = process.env.BLACKLIST_ALLIANCE_API_KEY;
    delete process.env.BLACKLIST_ALLIANCE_API_KEY;
    try {
      const blocked = await lookupDnc("3105550199", false);
      assert.equal(blocked.clean, false);
      assert.equal(blocked.source, "lead_field");

      const ok = await lookupDnc("3105550199", true);
      assert.equal(ok.clean, true);
      assert.equal(ok.source, "lead_field");
    } finally {
      if (prev != null) process.env.BLACKLIST_ALLIANCE_API_KEY = prev;
    }
  });

  it("calls Blacklist Alliance when API key is set", async () => {
    const prev = process.env.BLACKLIST_ALLIANCE_API_KEY;
    process.env.BLACKLIST_ALLIANCE_API_KEY = "test-key";
    try {
      let calledUrl = "";
      const fetchImpl = async (url: any) => {
        calledUrl = String(url);
        return {
          ok: true,
          json: async () => ({ status: "blacklisted" }),
        } as any;
      };
      const result = await lookupDnc("3105550199", null, fetchImpl as any);
      assert.equal(result.clean, false);
      assert.equal(result.source, "blacklist_alliance");
      assert.match(calledUrl, /api\.blacklistalliance\.net\/lookup/);
      assert.match(calledUrl, /phone=3105550199/);
      assert.match(calledUrl, /key=test-key/);
    } finally {
      if (prev != null) process.env.BLACKLIST_ALLIANCE_API_KEY = prev;
      else delete process.env.BLACKLIST_ALLIANCE_API_KEY;
    }
  });
});
