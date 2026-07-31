// ─── TCPA / COMPLIANCE (Module 8) ─────────────────────────────────────────────
// Shared by SDR call orchestrator + Reactor ComplianceGuardianAgent.
//
// Rules:
//   Quiet hours: 8AM–9PM in the lead's local timezone
//   DNC: Blacklist Alliance API (when keyed) + leads.dncClean
//   Frequency: max 3 call attempts per rolling 7 days (sdr_logs / sessions)
//   Consent: consentStatus !== 'opted_out'

import { db } from "./db.js";
import { leads, sdrCallSessions, sdrLogs } from "./schema.js";
import { and, eq, gte, sql, count } from "drizzle-orm";
import {
  CALLING_HOURS,
  MAX_CALL_ATTEMPTS_PER_WEEK,
} from "../reactor/config.js";

export { CALLING_HOURS, MAX_CALL_ATTEMPTS_PER_WEEK };

export const DEFAULT_LEAD_TIMEZONE = "America/New_York";

export type ComplianceReason =
  | "quiet_hours"
  | "dnc"
  | "frequency"
  | "opted_out"
  | "no_phone";

export type ComplianceResult =
  | { allowed: true }
  | { allowed: false; reason: ComplianceReason; nextAllowedAt?: Date; detail?: string };

export type ComplianceLead = {
  id?: number;
  phone?: string | null;
  timezone?: string | null;
  dncClean?: boolean | null;
  consentStatus?: string | null;
};

/** Digits-only phone, strip leading country code 1 for NANP. */
export function normalizePhoneDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length === 10) return digits;
  return digits.length >= 10 ? digits.slice(-10) : digits || null;
}

/** Compact NANP area-code → IANA timezone map (major markets). */
const AREA_CODE_TZ: Record<string, string> = {
  "201": "America/New_York", "202": "America/New_York", "212": "America/New_York",
  "215": "America/New_York", "301": "America/New_York", "302": "America/New_York",
  "305": "America/New_York", "313": "America/New_York", "404": "America/New_York",
  "407": "America/New_York", "410": "America/New_York", "412": "America/New_York",
  "443": "America/New_York", "516": "America/New_York", "561": "America/New_York",
  "609": "America/New_York", "617": "America/New_York", "646": "America/New_York",
  "703": "America/New_York", "704": "America/New_York", "718": "America/New_York",
  "754": "America/New_York", "786": "America/New_York", "813": "America/New_York",
  "845": "America/New_York", "856": "America/New_York", "860": "America/New_York",
  "862": "America/New_York", "904": "America/New_York", "908": "America/New_York",
  "912": "America/New_York", "914": "America/New_York", "917": "America/New_York",
  "929": "America/New_York", "954": "America/New_York", "973": "America/New_York",
  "214": "America/Chicago", "224": "America/Chicago", "251": "America/Chicago",
  "262": "America/Chicago", "281": "America/Chicago", "312": "America/Chicago",
  "314": "America/Chicago", "318": "America/Chicago", "319": "America/Chicago",
  "320": "America/Chicago", "331": "America/Chicago", "361": "America/Chicago",
  "405": "America/Chicago", "414": "America/Chicago", "417": "America/Chicago",
  "469": "America/Chicago", "501": "America/Chicago", "504": "America/Chicago",
  "512": "America/Chicago", "515": "America/Chicago", "531": "America/Chicago",
  "563": "America/Chicago", "573": "America/Chicago", "601": "America/Chicago",
  "608": "America/Chicago", "612": "America/Chicago", "615": "America/Chicago",
  "630": "America/Chicago", "636": "America/Chicago", "651": "America/Chicago",
  "682": "America/Chicago", "713": "America/Chicago", "715": "America/Chicago",
  "731": "America/Chicago", "737": "America/Chicago", "773": "America/Chicago",
  "785": "America/Chicago", "806": "America/Chicago", "815": "America/Chicago",
  "816": "America/Chicago", "817": "America/Chicago", "832": "America/Chicago",
  "847": "America/Chicago", "901": "America/Chicago", "913": "America/Chicago",
  "918": "America/Chicago", "920": "America/Chicago", "936": "America/Chicago",
  "940": "America/Chicago", "972": "America/Chicago",
  "303": "America/Denver", "385": "America/Denver", "406": "America/Denver",
  "480": "America/Phoenix", "505": "America/Denver", "520": "America/Phoenix",
  "602": "America/Phoenix", "623": "America/Phoenix", "719": "America/Denver",
  "720": "America/Denver", "801": "America/Denver", "928": "America/Phoenix",
  "970": "America/Denver",
  "206": "America/Los_Angeles", "209": "America/Los_Angeles", "213": "America/Los_Angeles",
  "253": "America/Los_Angeles", "310": "America/Los_Angeles", "323": "America/Los_Angeles",
  "360": "America/Los_Angeles", "408": "America/Los_Angeles", "415": "America/Los_Angeles",
  "424": "America/Los_Angeles", "442": "America/Los_Angeles", "503": "America/Los_Angeles",
  "510": "America/Los_Angeles", "530": "America/Los_Angeles", "541": "America/Los_Angeles",
  "562": "America/Los_Angeles", "619": "America/Los_Angeles", "626": "America/Los_Angeles",
  "650": "America/Los_Angeles", "657": "America/Los_Angeles", "661": "America/Los_Angeles",
  "669": "America/Los_Angeles", "702": "America/Los_Angeles", "707": "America/Los_Angeles",
  "714": "America/Los_Angeles", "747": "America/Los_Angeles", "760": "America/Los_Angeles",
  "775": "America/Los_Angeles", "805": "America/Los_Angeles", "808": "Pacific/Honolulu",
  "818": "America/Los_Angeles", "831": "America/Los_Angeles", "858": "America/Los_Angeles",
  "909": "America/Los_Angeles", "916": "America/Los_Angeles", "925": "America/Los_Angeles",
  "949": "America/Los_Angeles", "951": "America/Los_Angeles", "971": "America/Los_Angeles",
  "907": "America/Anchorage",
};

export function inferTimezoneFromPhone(phone: string | null | undefined): string {
  const digits = normalizePhoneDigits(phone);
  if (!digits || digits.length < 3) return DEFAULT_LEAD_TIMEZONE;
  return AREA_CODE_TZ[digits.slice(0, 3)] ?? DEFAULT_LEAD_TIMEZONE;
}

export function resolveLeadTimezone(lead: {
  timezone?: string | null;
  phone?: string | null;
}): string {
  const tz = lead.timezone?.trim();
  if (tz) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
      return tz;
    } catch {
      /* fall through */
    }
  }
  return inferTimezoneFromPhone(lead.phone);
}

/** Local hour 0–23 in the given IANA timezone. */
export function getLocalHour(now: Date, timeZone: string): number {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hourCycle: "h23",
  }).format(now);
  const hour = parseInt(formatted, 10);
  return Number.isFinite(hour) ? hour : now.getUTCHours();
}

/** True when local hour is in [start, end) — default 8 inclusive to 21 exclusive. */
export function isWithinCallingHours(
  localHour: number,
  start = CALLING_HOURS.start,
  end = CALLING_HOURS.end
): boolean {
  return localHour >= start && localHour < end;
}

export function nextAllowedCallingTime(
  now: Date,
  timeZone: string,
  startHour = CALLING_HOURS.start
): Date {
  const stepMs = 15 * 60 * 1000;
  for (let i = 0; i < 96; i++) {
    const candidate = new Date(now.getTime() + i * stepMs);
    if (isWithinCallingHours(getLocalHour(candidate, timeZone), startHour, CALLING_HOURS.end)) {
      if (i === 0) return now;
      return snapToLocalHour(candidate, timeZone, startHour);
    }
  }
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

function snapToLocalHour(approx: Date, timeZone: string, hour: number): Date {
  let t = approx.getTime();
  for (let i = 0; i < 60; i++) {
    const d = new Date(t - i * 60_000);
    if (getLocalHour(d, timeZone) === hour) {
      let m = d.getTime();
      while (getLocalHour(new Date(m - 60_000), timeZone) === hour) m -= 60_000;
      return new Date(m);
    }
  }
  return approx;
}

export function evaluateQuietHours(
  lead: ComplianceLead,
  now: Date = new Date()
): ComplianceResult {
  const tz = resolveLeadTimezone(lead);
  const localHour = getLocalHour(now, tz);
  if (isWithinCallingHours(localHour)) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: "quiet_hours",
    nextAllowedAt: nextAllowedCallingTime(now, tz),
    detail: `localHour=${localHour} tz=${tz}`,
  };
}

export function isFrequencyLimitReached(
  attemptsInWindow: number,
  limit = MAX_CALL_ATTEMPTS_PER_WEEK
): boolean {
  return attemptsInWindow >= limit;
}

export async function countCallAttemptsLastWeek(
  leadId: number,
  now: Date = new Date()
): Promise<number> {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [{ sessions }] = await db
    .select({ sessions: count() })
    .from(sdrCallSessions)
    .where(
      and(
        eq(sdrCallSessions.leadId, leadId),
        gte(sdrCallSessions.startedAt, since)
      )
    );

  if (Number(sessions) > 0) return Number(sessions);

  const [{ logs }] = await db
    .select({ logs: count() })
    .from(sdrLogs)
    .where(
      and(
        eq(sdrLogs.leadId, leadId),
        gte(sdrLogs.loggedAt, since),
        sql`(${sdrLogs.outcome} = 'call_initiated' OR ${sdrLogs.stepName} = 'call_initiated')`
      )
    );

  return Number(logs);
}

export async function evaluateCallFrequency(
  leadId: number,
  now: Date = new Date()
): Promise<ComplianceResult> {
  const attempts = await countCallAttemptsLastWeek(leadId, now);
  if (!isFrequencyLimitReached(attempts)) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: "frequency",
    nextAllowedAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    detail: `${attempts}/${MAX_CALL_ATTEMPTS_PER_WEEK} calls in 7 days`,
  };
}

export type DncLookupResult = {
  clean: boolean;
  source: "blacklist_alliance" | "lead_field" | "skipped";
  raw?: unknown;
};

/** Exported for unit tests — parse Blacklist Alliance JSON into clean/hit. */
export function parseBlacklistResponse(data: unknown): boolean {
  if (data == null) return true;
  if (typeof data === "string") {
    const s = data.toLowerCase();
    if (s.includes("blacklist") || s.includes("listed") || s === "bad") return false;
    return true;
  }
  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (obj.blacklisted === true || obj.isBlacklisted === true || obj.listed === true) {
      return false;
    }
    if (obj.clean === false || obj.dncClean === false) return false;
    if (typeof obj.status === "string") {
      const s = obj.status.toLowerCase();
      if (s === "blacklisted" || s === "listed" || s === "dnc" || s === "bad") return false;
      if (s === "clean" || s === "good" || s === "ok") return true;
    }
    if (typeof obj.message === "string") {
      const s = obj.message.toLowerCase();
      if (s.includes("blacklist") || s === "bad") return false;
      if (s === "good" || s.includes("clean")) return true;
    }
    if (Array.isArray(obj.results) && obj.results.length > 0) return false;
  }
  return true;
}

export async function lookupDnc(
  phone: string | null | undefined,
  existingDncClean?: boolean | null,
  fetchImpl: typeof fetch = fetch
): Promise<DncLookupResult> {
  if (existingDncClean === false) {
    return { clean: false, source: "lead_field" };
  }

  const digits = normalizePhoneDigits(phone);
  if (!digits) {
    return { clean: true, source: "skipped" };
  }

  const apiKey = process.env.BLACKLIST_ALLIANCE_API_KEY;
  if (!apiKey) {
    return {
      clean: existingDncClean !== false,
      source: "lead_field",
    };
  }

  const url = new URL("https://api.blacklistalliance.net/lookup");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("phone", digits);
  url.searchParams.set("ver", process.env.BLACKLIST_ALLIANCE_API_VER || "v1");
  url.searchParams.set("resp", "json");

  try {
    const res = await fetchImpl(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      console.warn(`DNC API HTTP ${res.status} — falling back to lead.dncClean`);
      return {
        clean: existingDncClean !== false,
        source: "lead_field",
        raw: { httpStatus: res.status },
      };
    }

    const data = await res.json().catch(() => null);
    const clean = parseBlacklistResponse(data);
    return { clean, source: "blacklist_alliance", raw: data };
  } catch (err: any) {
    console.warn(`DNC API error: ${err?.message || err} — falling back to lead.dncClean`);
    return {
      clean: existingDncClean !== false,
      source: "lead_field",
      raw: { error: String(err?.message || err) },
    };
  }
}

export async function persistDncResult(leadId: number, clean: boolean): Promise<void> {
  await db
    .update(leads)
    .set({ dncClean: clean })
    .where(eq(leads.id, leadId));
}

/**
 * Full TCPA pre-call check (plan §5). Call before placing Twilio dial.
 */
export async function checkCallCompliance(
  lead: ComplianceLead & { id: number },
  opts: { now?: Date; skipDncApi?: boolean; fetchImpl?: typeof fetch } = {}
): Promise<ComplianceResult> {
  const now = opts.now ?? new Date();

  if (!lead.phone) {
    return { allowed: false, reason: "no_phone" };
  }

  if (lead.consentStatus === "opted_out") {
    return { allowed: false, reason: "opted_out" };
  }

  const quiet = evaluateQuietHours(lead, now);
  if (!quiet.allowed) return quiet;

  const freq = await evaluateCallFrequency(lead.id, now);
  if (!freq.allowed) return freq;

  const dnc = opts.skipDncApi
    ? ({
        clean: lead.dncClean !== false,
        source: "lead_field" as const,
      })
    : await lookupDnc(lead.phone, lead.dncClean, opts.fetchImpl);

  if (!dnc.clean) {
    if (lead.id && dnc.source === "blacklist_alliance") {
      await persistDncResult(lead.id, false).catch(() => {});
    }
    return { allowed: false, reason: "dnc", detail: dnc.source };
  }

  if (lead.id && dnc.source === "blacklist_alliance" && lead.dncClean == null) {
    await persistDncResult(lead.id, true).catch(() => {});
  }

  return { allowed: true };
}
