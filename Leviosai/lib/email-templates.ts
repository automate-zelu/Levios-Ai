/**
 * Product emails (account, billing, bookings).
 * Lead SDR follow-ups stay on the client's Gmail + their own templates.
 */

import { formatUsdFromCents } from "./commercial-pricing.js";

export type EmailContent = {
  subject: string;
  text: string;
  html: string;
};

const BRAND = "Leviosai";

export function appUrl(path = "/"): string {
  const base = (process.env.BASE_URL || process.env.APP_URL || "http://localhost:3000").replace(
    /\/$/,
    ""
  );
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

export function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapHtml(opts: {
  preheader?: string;
  title: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
}): string {
  const cta =
    opts.ctaLabel && opts.ctaUrl
      ? `<p style="margin:28px 0 8px"><a href="${escapeHtml(opts.ctaUrl)}" style="display:inline-block;background:#e67e22;color:#fff;text-decoration:none;font-family:Georgia,Times,serif;font-size:15px;letter-spacing:0.04em;padding:12px 22px;border-radius:2px">${escapeHtml(opts.ctaLabel)}</a></p>`
      : "";
  const pre = opts.preheader
    ? `<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(opts.preheader)}</span>`
    : "";
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f3efe8">
${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3efe8;padding:32px 12px">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fffdf8;border:1px solid #e4ddd2">
      <tr><td style="padding:28px 32px 12px;border-bottom:3px solid #e67e22">
        <div style="font-family:Georgia,Times,serif;font-size:13px;letter-spacing:0.28em;text-transform:uppercase;color:#e67e22">${BRAND}</div>
      </td></tr>
      <tr><td style="padding:28px 32px 36px;font-family:Georgia,Times,serif;color:#1c1917">
        <h1 style="margin:0 0 16px;font-size:26px;line-height:1.25;font-weight:normal">${escapeHtml(opts.title)}</h1>
        <div style="font-size:16px;line-height:1.55;color:#44403c">${opts.bodyHtml}</div>
        ${cta}
        <p style="margin:36px 0 0;font-size:12px;letter-spacing:0.04em;color:#a8a29e">${BRAND} · sales that keep moving</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

export function welcomeEmail(input: {
  firstName: string;
  organizationName: string;
}): EmailContent {
  const first = input.firstName.trim() || "there";
  const org = input.organizationName.trim() || "your account";
  const url = appUrl("/billing");
  const text = [
    `Hi ${first},`,
    "",
    `Welcome to ${BRAND}. ${org} is set up.`,
    "",
    "Next: add a card on Billing so the monthly retainer and appointment fees can run automatically.",
    url,
    "",
    `— ${BRAND}`,
  ].join("\n");
  return {
    subject: `Welcome to ${BRAND}`,
    text,
    html: wrapHtml({
      preheader: `${org} is ready.`,
      title: `Welcome, ${first}`,
      bodyHtml: `<p>${escapeHtml(org)} is on ${BRAND}.</p><p>Add a payment method so your monthly retainer and per-appointment fees charge on your billing date.</p>`,
      ctaLabel: "Open billing",
      ctaUrl: url,
    }),
  };
}

export function inviteEmail(input: {
  firstName: string;
  inviterName: string;
  organizationName: string;
  email: string;
  temporaryPassword?: string | null;
}): EmailContent {
  const first = input.firstName.trim() || "there";
  const org = input.organizationName.trim() || "the team";
  const url = appUrl("/");
  const passwordLine = input.temporaryPassword
    ? `Temporary password: ${input.temporaryPassword}`
    : "Use the password your teammate shared with you.";
  const text = [
    `Hi ${first},`,
    "",
    `${input.inviterName} invited you to ${org} on ${BRAND}.`,
    `Sign in with ${input.email}.`,
    passwordLine,
    url,
    "",
    `— ${BRAND}`,
  ].join("\n");
  const passwordHtml = input.temporaryPassword
    ? `<p>Temporary password: <code style="font-size:15px">${escapeHtml(input.temporaryPassword)}</code></p>`
    : `<p>Use the password your teammate shared with you.</p>`;
  return {
    subject: `You're invited to ${org} on ${BRAND}`,
    text,
    html: wrapHtml({
      preheader: `${input.inviterName} invited you to ${org}.`,
      title: `Join ${org}`,
      bodyHtml: `<p>${escapeHtml(input.inviterName)} added you to ${escapeHtml(org)} on ${BRAND}.</p><p>Sign in with <strong>${escapeHtml(input.email)}</strong>.</p>${passwordHtml}`,
      ctaLabel: "Sign in",
      ctaUrl: url,
    }),
  };
}

export function billReceiptEmail(input: {
  firstName?: string | null;
  organizationName: string;
  feeKind: "monthly" | "appointment" | string;
  amountCents: number;
  description?: string | null;
  chargeId?: number | null;
}): EmailContent {
  const first = (input.firstName || "").trim() || "there";
  const kind = input.feeKind === "appointment" ? "Appointment booking" : "Monthly retainer";
  const amount = formatUsdFromCents(input.amountCents);
  const url = appUrl("/billing");
  const desc = (input.description || kind).trim();
  const text = [
    `Hi ${first},`,
    "",
    `We charged ${amount} to the card on file for ${input.organizationName}.`,
    desc,
    input.chargeId != null ? `Receipt #${input.chargeId}` : "",
    url,
    "",
    `— ${BRAND}`,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    subject: `Receipt: ${amount} · ${kind}`,
    text,
    html: wrapHtml({
      preheader: `${amount} charged for ${kind.toLowerCase()}.`,
      title: `Receipt · ${amount}`,
      bodyHtml: `<p>Hi ${escapeHtml(first)},</p><p>We charged the card on file for <strong>${escapeHtml(input.organizationName)}</strong>.</p><p style="font-size:22px;margin:20px 0">${escapeHtml(amount)}</p><p>${escapeHtml(desc)}${input.chargeId != null ? `<br>Receipt #${input.chargeId}` : ""}</p>`,
      ctaLabel: "View billing",
      ctaUrl: url,
    }),
  };
}

export function paymentFailedEmail(input: {
  firstName?: string | null;
  organizationName: string;
  amountCents?: number | null;
  errorMessage?: string | null;
}): EmailContent {
  const first = (input.firstName || "").trim() || "there";
  const url = appUrl("/billing");
  const amount =
    input.amountCents != null && input.amountCents > 0
      ? formatUsdFromCents(input.amountCents)
      : "your latest invoice";
  const text = [
    `Hi ${first},`,
    "",
    `We could not charge ${amount} for ${input.organizationName}.`,
    input.errorMessage ? `Reason: ${input.errorMessage}` : "",
    "Update the card on Billing so the SDR agent can stay on.",
    url,
    "",
    `— ${BRAND}`,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    subject: `Payment failed for ${input.organizationName}`,
    text,
    html: wrapHtml({
      preheader: "Update your card so Leviosai can keep running.",
      title: "We couldn't charge your card",
      bodyHtml: `<p>Hi ${escapeHtml(first)},</p><p>The charge of ${escapeHtml(amount)} for <strong>${escapeHtml(input.organizationName)}</strong> did not go through.${input.errorMessage ? ` ${escapeHtml(input.errorMessage)}` : ""}</p><p>Update the payment method so the agent can stay active.</p>`,
      ctaLabel: "Update card",
      ctaUrl: url,
    }),
  };
}

export function subscriptionCanceledEmail(input: {
  firstName?: string | null;
  organizationName: string;
  accessThrough?: string | null;
}): EmailContent {
  const first = (input.firstName || "").trim() || "there";
  const until = input.accessThrough || "the end of this billing period";
  const url = appUrl("/billing");
  const text = [
    `Hi ${first},`,
    "",
    `Monthly retainer auto-renew is off for ${input.organizationName}.`,
    `You keep access through ${until}.`,
    "Appointment booking fees are still charged to your card when meetings are booked.",
    url,
    "",
    `— ${BRAND}`,
  ].join("\n");
  return {
    subject: `Monthly retainer canceled · ${input.organizationName}`,
    text,
    html: wrapHtml({
      preheader: `Access continues through ${until}.`,
      title: "Monthly retainer canceled",
      bodyHtml: `<p>Hi ${escapeHtml(first)},</p><p>Auto-renew is off for <strong>${escapeHtml(input.organizationName)}</strong>. You keep access through ${escapeHtml(until)}.</p><p>Appointment bookings are still charged to your card.</p>`,
      ctaLabel: "Manage billing",
      ctaUrl: url,
    }),
  };
}

export function subscriptionResumedEmail(input: {
  firstName?: string | null;
  organizationName: string;
  nextBillingAt?: string | null;
}): EmailContent {
  const first = (input.firstName || "").trim() || "there";
  const next = input.nextBillingAt || "your next billing date";
  const url = appUrl("/billing");
  const text = [
    `Hi ${first},`,
    "",
    `Monthly retainer auto-renew is back on for ${input.organizationName}.`,
    `Next card charge: ${next}.`,
    url,
    "",
    `— ${BRAND}`,
  ].join("\n");
  return {
    subject: `Subscription resumed · ${input.organizationName}`,
    text,
    html: wrapHtml({
      preheader: `Next charge ${next}.`,
      title: "Subscription resumed",
      bodyHtml: `<p>Hi ${escapeHtml(first)},</p><p>The monthly retainer for <strong>${escapeHtml(input.organizationName)}</strong> will charge automatically again.</p><p>Next card charge: ${escapeHtml(next)}.</p>`,
      ctaLabel: "View billing",
      ctaUrl: url,
    }),
  };
}

export function bookingEmail(input: {
  kind: "confirmed" | "rescheduled" | "cancelled" | "removed";
  firstName?: string | null;
  title: string;
  whenLabel: string;
  newWhenLabel?: string | null;
  companyName?: string | null;
}): EmailContent {
  const first = (input.firstName || "").trim() || "there";
  const company = (input.companyName || "").trim() || BRAND;
  const title = input.title || "appointment";
  const map = {
    confirmed: {
      subject: `Confirmed: ${title}`,
      line: `Your ${title} is booked for ${input.whenLabel}.`,
    },
    rescheduled: {
      subject: `Rescheduled: ${title}`,
      line: `Your ${title} moved from ${input.whenLabel} to ${input.newWhenLabel || ""}.`,
    },
    cancelled: {
      subject: `Cancelled: ${title}`,
      line: `Your ${title} on ${input.whenLabel} has been cancelled.`,
    },
    removed: {
      subject: `Removed: ${title}`,
      line: `Your ${title} on ${input.whenLabel} has been removed from the calendar.`,
    },
  } as const;
  const copy = map[input.kind];
  const text = [`Hi ${first},`, "", copy.line, "", `Reply if you need a different time.`, "", `— ${company}`].join(
    "\n"
  );
  return {
    subject: copy.subject,
    text,
    html: wrapHtml({
      preheader: copy.line,
      title: copy.subject,
      bodyHtml: `<p>Hi ${escapeHtml(first)},</p><p>${escapeHtml(copy.line)}</p><p>Reply to this email if you need a different time.</p><p>— ${escapeHtml(company)}</p>`,
    }),
  };
}

export function styledPlainEmail(subject: string, text: string): EmailContent {
  const htmlBody = `<p>${escapeHtml(text).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;
  return {
    subject,
    text,
    html: wrapHtml({ title: subject, bodyHtml: htmlBody }),
  };
}

export const PRODUCT_EMAIL_KINDS = [
  "welcome",
  "invite",
  "bill_receipt",
  "payment_failed",
  "subscription_canceled",
  "subscription_resumed",
  "booking_confirmed",
  "booking_rescheduled",
  "booking_cancelled",
] as const;

export type ProductEmailKind = (typeof PRODUCT_EMAIL_KINDS)[number];

export function buildProductEmail(
  kind: ProductEmailKind,
  sample: {
    firstName?: string;
    organizationName?: string;
    inviterName?: string;
    email?: string;
    temporaryPassword?: string;
  } = {}
): EmailContent {
  const firstName = sample.firstName || "Awais";
  const organizationName = sample.organizationName || "Northpeak HVAC";
  switch (kind) {
    case "welcome":
      return welcomeEmail({ firstName, organizationName });
    case "invite":
      return inviteEmail({
        firstName,
        inviterName: sample.inviterName || "Sam Rivera",
        organizationName,
        email: sample.email || "btwimawawis@gmail.com",
        temporaryPassword: sample.temporaryPassword || "Invite-test9!",
      });
    case "bill_receipt":
      return billReceiptEmail({
        firstName,
        organizationName,
        feeKind: "monthly",
        amountCents: 29700,
        description: "Monthly retainer — Sep 15, 2026",
        chargeId: 1042,
      });
    case "payment_failed":
      return paymentFailedEmail({
        firstName,
        organizationName,
        amountCents: 29700,
        errorMessage: "Card declined.",
      });
    case "subscription_canceled":
      return subscriptionCanceledEmail({
        firstName,
        organizationName,
        accessThrough: "Oct 15, 2026",
      });
    case "subscription_resumed":
      return subscriptionResumedEmail({
        firstName,
        organizationName,
        nextBillingAt: "Oct 15, 2026",
      });
    case "booking_confirmed":
      return bookingEmail({
        kind: "confirmed",
        firstName,
        title: "HVAC consult",
        whenLabel: "Thu, Oct 2, 2026, 2:00 PM",
        companyName: organizationName,
      });
    case "booking_rescheduled":
      return bookingEmail({
        kind: "rescheduled",
        firstName,
        title: "HVAC consult",
        whenLabel: "Thu, Oct 2, 2026, 2:00 PM",
        newWhenLabel: "Fri, Oct 3, 2026, 10:00 AM",
        companyName: organizationName,
      });
    case "booking_cancelled":
      return bookingEmail({
        kind: "cancelled",
        firstName,
        title: "HVAC consult",
        whenLabel: "Thu, Oct 2, 2026, 2:00 PM",
        companyName: organizationName,
      });
  }
}
