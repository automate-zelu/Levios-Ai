/**
 * Booking cancel / reschedule / delete copy and state rules.
 * Run: npx tsx --test tests/booking-lifecycle.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canPerformBookingAction,
  planBookingMutation,
  composeBookingNotice,
  formatBookingWhen,
} from "../lib/booking-lifecycle.js";
import { parseScheduledAt } from "../lib/calendar/booking-helpers.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("booking action rules", () => {
  it("allows cancel and reschedule on scheduled bookings", () => {
    assert.equal(canPerformBookingAction("scheduled", "cancel").ok, true);
    assert.equal(canPerformBookingAction("scheduled", "reschedule").ok, true);
    assert.equal(canPerformBookingAction("scheduled", "delete").ok, true);
  });

  it("blocks a second cancel", () => {
    const r = canPerformBookingAction("cancelled", "cancel");
    assert.equal(r.ok, false);
    assert.match(r.reason || "", /already cancelled/i);
  });

  it("still allows reschedule after cancel (rebook)", () => {
    assert.equal(canPerformBookingAction("cancelled", "reschedule").ok, true);
  });

  it("blocks cancel/reschedule on completed and no-show", () => {
    assert.equal(canPerformBookingAction("completed", "cancel").ok, false);
    assert.equal(canPerformBookingAction("completed", "reschedule").ok, false);
    assert.equal(canPerformBookingAction("no-show", "cancel").ok, false);
    assert.equal(canPerformBookingAction("completed", "delete").ok, true);
  });
});

describe("booking mutation plan", () => {
  it("cancel marks cancelled and deletes calendar event", () => {
    assert.deepEqual(planBookingMutation("cancel"), {
      nextStatus: "cancelled",
      deleteRow: false,
      calendar: "delete",
    });
  });

  it("reschedule keeps row scheduled and patches calendar", () => {
    assert.deepEqual(planBookingMutation("reschedule"), {
      nextStatus: "scheduled",
      deleteRow: false,
      calendar: "patch",
    });
  });

  it("delete removes the CRM row and calendar event", () => {
    assert.deepEqual(planBookingMutation("delete"), {
      nextStatus: null,
      deleteRow: true,
      calendar: "delete",
    });
  });
});

describe("booking notices", () => {
  it("cancel SMS and email mention the original time", () => {
    const n = composeBookingNotice({
      action: "cancel",
      leadFirstName: "Mohammed",
      title: "Consultation — Mohammed Awais",
      previousWhen: "Mon, Aug 17, 9:00 AM",
      companyName: "NorthPeak HVAC",
    });
    assert.match(n.sms, /cancelled/i);
    assert.match(n.sms, /Mon, Aug 17, 9:00 AM/);
    assert.match(n.sms, /Mohammed/);
    assert.match(n.emailSubject, /Cancelled/i);
    assert.match(n.emailBody, /NorthPeak HVAC/);
  });

  it("reschedule SMS and email include both times", () => {
    const n = composeBookingNotice({
      action: "reschedule",
      leadFirstName: "Mohammed",
      title: "Consultation",
      previousWhen: "Mon, Aug 17, 9:00 AM",
      nextWhen: "Tue, Aug 18, 10:00 AM",
      companyName: "Levios Demo",
    });
    assert.match(n.sms, /moved from Mon, Aug 17, 9:00 AM to Tue, Aug 18, 10:00 AM/);
    assert.match(n.emailSubject, /Rescheduled/i);
    assert.match(n.emailBody, /Previous: Mon, Aug 17, 9:00 AM/);
    assert.match(n.emailBody, /New time: Tue, Aug 18, 10:00 AM/);
  });

  it("delete notice says the booking was removed", () => {
    const n = composeBookingNotice({
      action: "delete",
      leadFirstName: "Mohammed",
      title: "Consultation",
      previousWhen: "Tue, Aug 18, 10:00 AM",
    });
    assert.match(n.sms, /removed/i);
    assert.match(n.emailSubject, /Removed/i);
  });

  it("falls back to there when first name is missing", () => {
    const n = composeBookingNotice({
      action: "cancel",
      title: "Consultation",
      previousWhen: "Tue 10:00 AM",
    });
    assert.match(n.sms, /Hi there/);
  });
});

describe("booking time helpers", () => {
  it("formats in America/New_York not UTC clock hour", () => {
    const d = new Date("2026-08-17T13:00:00.000Z");
    const label = formatBookingWhen(d, "America/New_York");
    assert.match(label, /9:00/);
    assert.doesNotMatch(label, /1:00/);
  });

  it("parses ISO scheduledAt for reschedule payloads", () => {
    const d = parseScheduledAt("2026-08-18T14:00:00.000Z");
    assert.ok(d);
    assert.equal(d!.toISOString(), "2026-08-18T14:00:00.000Z");
    assert.equal(parseScheduledAt(""), null);
    assert.equal(parseScheduledAt("not-a-date"), null);
  });
});

describe("booking UI and API wiring", () => {
  it("exposes cancel, reschedule, and delete appointment routes", () => {
    const api = readFileSync(path.join(root, "routes/api.ts"), "utf8");
    assert.match(api, /\/api\/appointments\/:id\/cancel/);
    assert.match(api, /\/api\/appointments\/:id\/reschedule/);
    assert.match(api, /handleAppointmentMutation\(req, res, "delete"\)/);
    assert.match(api, /mutateAppointmentWithCalendar/);
  });

  it("ships Bookings page with cancel, reschedule, delete, and notify", () => {
    const page = readFileSync(path.join(root, "client/src/pages/BookingsPage.jsx"), "utf8");
    assert.match(page, /appointmentsApi\.cancel/);
    assert.match(page, /appointmentsApi\.reschedule/);
    assert.match(page, /appointmentsApi\.delete/);
    assert.match(page, /Send SMS and email/);
    const app = readFileSync(path.join(root, "client/src/App.jsx"), "utf8");
    assert.match(app, /BookingsPage/);
    assert.match(app, /"Bookings": "\/bookings"/);
  });
});
