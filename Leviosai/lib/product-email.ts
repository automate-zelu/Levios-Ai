/**
 * Send Leviosai product emails (Resend). Never throws — callers fire-and-forget.
 */

import { eq } from "drizzle-orm";
import { db } from "./db.js";
import { organizations, users } from "./schema.js";
import { sendEmail, isResendConfigured } from "./resend.js";
import {
  billReceiptEmail,
  paymentFailedEmail,
  type EmailContent,
} from "./email-templates.js";

export async function sendProductEmail(
  to: string | string[],
  mail: EmailContent
): Promise<{ success: boolean; id?: string; error?: string }> {
  const recipients = (Array.isArray(to) ? to : [to])
    .map((e) => String(e || "").trim())
    .filter(Boolean);
  if (!recipients.length) return { success: false, error: "no_recipient" };
  if (!isResendConfigured()) {
    console.warn("Product email skipped — Resend not configured:", mail.subject);
    return { success: false, error: "resend_unconfigured" };
  }

  let last: { success: boolean; id?: string; error?: string } = { success: false, error: "not_sent" };
  for (const addr of recipients) {
    last = await sendEmail(addr, mail.subject, mail.text, mail.html);
    if (!last.success) {
      console.error(`Product email failed (${addr}):`, last.error);
    } else {
      console.log(`📧 ${mail.subject} → ${addr}`);
    }
  }
  return last;
}

export async function emailOrganizationMembers(
  organizationId: number,
  mail: EmailContent
): Promise<{ success: boolean; sent: number }> {
  const members = await db
    .select({ email: users.email, firstName: users.firstName })
    .from(users)
    .where(eq(users.organizationId, organizationId));
  const addresses = members.map((m) => m.email).filter(Boolean);
  if (!addresses.length) return { success: false, sent: 0 };
  const result = await sendProductEmail(addresses, mail);
  return { success: !!result.success, sent: result.success ? addresses.length : 0 };
}

async function orgMailContext(organizationId: number) {
  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  const members = await db
    .select({ email: users.email, firstName: users.firstName })
    .from(users)
    .where(eq(users.organizationId, organizationId));
  return {
    organizationName: org?.name || `Account ${organizationId}`,
    firstName: members[0]?.firstName || null,
    emails: members.map((m) => m.email).filter(Boolean),
  };
}

export async function notifyOrgBillPaid(input: {
  organizationId: number;
  feeKind: string;
  amountCents: number;
  description?: string | null;
  chargeId?: number | null;
}): Promise<void> {
  try {
    const ctx = await orgMailContext(input.organizationId);
    if (!ctx.emails.length) return;
    await sendProductEmail(
      ctx.emails,
      billReceiptEmail({
        firstName: ctx.firstName,
        organizationName: ctx.organizationName,
        feeKind: input.feeKind,
        amountCents: input.amountCents,
        description: input.description,
        chargeId: input.chargeId,
      })
    );
  } catch (err: any) {
    console.error("notifyOrgBillPaid:", err?.message || err);
  }
}

export async function notifyOrgPaymentFailed(input: {
  organizationId: number;
  amountCents?: number | null;
  errorMessage?: string | null;
}): Promise<void> {
  try {
    const ctx = await orgMailContext(input.organizationId);
    if (!ctx.emails.length) return;
    await sendProductEmail(
      ctx.emails,
      paymentFailedEmail({
        firstName: ctx.firstName,
        organizationName: ctx.organizationName,
        amountCents: input.amountCents,
        errorMessage: input.errorMessage,
      })
    );
  } catch (err: any) {
    console.error("notifyOrgPaymentFailed:", err?.message || err);
  }
}
