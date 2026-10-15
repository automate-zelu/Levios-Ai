/**
 * P2 — Core app UX (dashboard, calendar, timeline, proposals, sandbox gate).
 * Run: npx tsx --test tests/p2-core-ux.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const {
  buildLeadTimeline,
  filterTimelineByChannel,
  mapMessagesToTimeline,
} = await import("../client/src/lib/lead-timeline.js");

const {
  weekDays,
  monthGrid,
  appointmentsOnDay,
  sameDay,
} = await import("../client/src/lib/booking-calendar.js");

const { canAccessSandbox } = await import("../client/src/lib/sandbox-access.js");
const { isSandboxEnabledForRequest } = await import("../lib/sandbox-gate.js");

describe("P2.1 dashboard chrome", () => {
  const app = readFileSync(path.join(root, "client/src/App.jsx"), "utf8");

  it("removes TCPA Compliant badge from chrome", () => {
    assert.doesNotMatch(app, /function ComplianceBadge/);
    assert.doesNotMatch(app, /TCPA Compliant/);
    assert.doesNotMatch(app, /compliance-badge-topbar/);
  });

  it("does not hardcode fake revival/channel demo charts", () => {
    assert.doesNotMatch(app, /month: "Oct", revived: 45/);
    assert.doesNotMatch(app, /name: "Voice AI", value: 38/);
    assert.doesNotMatch(app, /Show-Up Rate", value: "87"/);
    assert.match(app, /Pipeline snapshot|No pipeline data yet/);
  });

  it("does not promote Sandbox from dashboard CTA", () => {
    assert.doesNotMatch(app, /See me in action/);
    assert.match(app, /Open calendar/);
  });
});

describe("P2.2 booking calendar helpers", () => {
  it("builds week and month grids", () => {
    const d = new Date(2026, 2, 15); // Sun Mar 15 2026-ish
    assert.equal(weekDays(d).length, 7);
    assert.equal(monthGrid(d).length, 42);
  });

  it("filters appointments onto a day", () => {
    const day = new Date(2026, 2, 15, 12, 0, 0);
    const onDay = new Date(day);
    onDay.setHours(14, 0, 0, 0);
    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(14, 0, 0, 0);
    const rows = [
      { id: 1, scheduledAt: onDay.toISOString() },
      { id: 2, scheduledAt: nextDay.toISOString() },
    ];
    assert.equal(appointmentsOnDay(rows, day).length, 1);
    assert.equal(sameDay(day, new Date(2026, 2, 15)), true);
  });

  it("BookingsPage exposes day/week/month/list views", () => {
    const src = readFileSync(path.join(root, "client/src/pages/BookingsPage.jsx"), "utf8");
    assert.match(src, /setView\("week"\)|useState\("week"\)/);
    assert.match(src, /"day".*"week".*"month".*"list"|day.*week.*month.*list/s);
    assert.match(src, /bookings-cal-week|bookings-cal-month/);
  });
});

describe("P2.3 lead timeline", () => {
  it("builds chronological timeline without inventing rows", () => {
    assert.deepEqual(buildLeadTimeline({}), []);
    const items = buildLeadTimeline({
      messages: [
        { id: 1, channel: "sms", content: "Hi", createdAt: "2026-03-02T10:00:00.000Z", direction: "outbound" },
      ],
      appointments: [
        { id: 9, title: "Consult", scheduledAt: "2026-03-03T15:00:00.000Z", status: "scheduled" },
      ],
    });
    assert.equal(items.length, 2);
    assert.equal(items[0].channel, "appointment"); // newer first
    assert.equal(mapMessagesToTimeline([]).length, 0);
    assert.equal(filterTimelineByChannel(items, "sms").length, 1);
  });

  it("ships timeline panel and nav without standalone Replay", () => {
    assert.ok(existsSync(path.join(root, "client/src/components/leads/LeadTimelinePanel.jsx")));
    const lead = readFileSync(path.join(root, "client/src/pages/LeadDetailPage.jsx"), "utf8");
    assert.match(lead, /LeadTimelinePanel/);
    assert.match(lead, /timeline/);
    const app = readFileSync(path.join(root, "client/src/App.jsx"), "utf8");
    assert.doesNotMatch(app, /name: "Conversation Replay"/);
    assert.match(app, /\/replay[\s\S]*navigate\("\/leads"/);
  });
});

describe("P2.4 / P2.5 proposals + sandbox", () => {
  it("proposals drop financing grid and white-label box", () => {
    const app = readFileSync(path.join(root, "client/src/App.jsx"), "utf8");
    const start = app.indexOf("function ProposalsPage()");
    const next = app.indexOf("\nfunction ", start + 10);
    const block = app.slice(start, next);
    assert.doesNotMatch(block, /Financing Options/);
    assert.doesNotMatch(block, /White-Label/);
    assert.match(block, /packageType|Package/);
  });

  it("sandbox access is gated client + server", () => {
    assert.equal(canAccessSandbox("user"), false);
    assert.equal(canAccessSandbox("admin"), true);
    assert.equal(isSandboxEnabledForRequest({ userRole: "user" } as any), false);
    assert.equal(isSandboxEnabledForRequest({ userRole: "admin" } as any), true);
    const sandbox = readFileSync(path.join(root, "routes/sandbox.ts"), "utf8");
    assert.match(sandbox, /requireSandboxAccess/);
    const app = readFileSync(path.join(root, "client/src/App.jsx"), "utf8");
    assert.match(app, /canAccessSandbox/);
  });
});
