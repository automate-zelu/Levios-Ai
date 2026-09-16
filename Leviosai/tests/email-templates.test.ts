/**
 * Product email templates (invite, register, bills, bookings).
 * Run: npx tsx --test tests/email-templates.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRODUCT_EMAIL_KINDS,
  buildProductEmail,
  inviteEmail,
  welcomeEmail,
  billReceiptEmail,
  escapeHtml,
} from "../lib/email-templates.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("product email templates", () => {
  it("builds every account email kind", () => {
    for (const kind of PRODUCT_EMAIL_KINDS) {
      const mail = buildProductEmail(kind, { email: "btwimawawis@gmail.com" });
      assert.ok(mail.subject.length > 4, kind);
      assert.match(mail.html, /<!DOCTYPE html>/);
      assert.match(mail.html, /Leviosai/);
    }
  });

  it("invite includes sign-in and temp password", () => {
    const mail = inviteEmail({
      firstName: "Awais",
      inviterName: "Sam",
      organizationName: "Northpeak",
      email: "btwimawawis@gmail.com",
      temporaryPassword: "Invite-abc!",
    });
    assert.match(mail.subject, /invited/i);
    assert.match(mail.text, /Invite-abc!/);
    assert.match(mail.html, /btwimawawis@gmail.com/);
  });

  it("welcome and bill receipt include billing CTA", () => {
    const welcome = welcomeEmail({ firstName: "Awais", organizationName: "Northpeak" });
    assert.match(welcome.subject, /Welcome/);
    assert.match(welcome.html, /billing/i);
    const bill = billReceiptEmail({
      firstName: "Awais",
      organizationName: "Northpeak",
      feeKind: "appointment",
      amountCents: 40000,
      chargeId: 9,
    });
    assert.match(bill.subject, /\$400/);
    assert.match(bill.html, /Receipt #9/);
  });

  it("escapes HTML in user-provided strings", () => {
    assert.equal(escapeHtml('<script>x</script>'), "&lt;script&gt;x&lt;/script&gt;");
    const mail = welcomeEmail({ firstName: "<b>X</b>", organizationName: "A&B" });
    assert.ok(!mail.html.includes("<b>X</b>"));
    assert.match(mail.html, /A&amp;B/);
  });
});

describe("product email wiring", () => {
  it("sends welcome, invite, bills, cancel, and booking confirmation", () => {
    const auth = readFileSync(path.join(root, "routes/auth.ts"), "utf8");
    assert.match(auth, /welcomeEmail/);
    const team = readFileSync(path.join(root, "routes/team.ts"), "utf8");
    assert.match(team, /inviteEmail/);
    const billing = readFileSync(path.join(root, "lib/subscription-billing.ts"), "utf8");
    assert.match(billing, /notifyOrgBillPaid/);
    assert.match(billing, /notifyOrgPaymentFailed/);
    const routes = readFileSync(path.join(root, "routes/billing.ts"), "utf8");
    assert.match(routes, /subscriptionCanceledEmail/);
    assert.match(routes, /subscriptionResumedEmail/);
    const calendar = readFileSync(path.join(root, "lib/calendar/service.ts"), "utf8");
    assert.match(calendar, /bookingEmail/);
    const notify = readFileSync(path.join(root, "lib/booking-notify-send.ts"), "utf8");
    assert.match(notify, /styledPlainEmail/);
  });
});
