import { Resend } from "resend";
import "dotenv/config";

const apiKey = process.env.RESEND_API_KEY;

const client = apiKey ? new Resend(apiKey) : null;

export function isResendConfigured(): boolean {
  return !!apiKey;
}

export function resendFromEmail(): string {
  return process.env.RESEND_FROM_EMAIL || "christian@leviosai.io";
}

export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  html?: string
): Promise<{ success: boolean; id?: string; error?: string }> {
  const { resolveEmailDelivery } = await import("./email-delivery.js");
  const plan = resolveEmailDelivery(to);
  if (plan.skipped) {
    console.log(`[email] skipped (${plan.reason}): ${subject}`);
    return { success: true, id: "skipped_test" };
  }
  const recipient = plan.recipients[0];
  if (!recipient) {
    return { success: false, error: "no_recipient" };
  }
  if (plan.redirected) {
    console.log(`[email] redirected → ${recipient}: ${subject}`);
  }

  if (!client) {
    return { success: false, error: "Resend not configured. Set RESEND_API_KEY in .env" };
  }

  try {
    const { data, error } = await client.emails.send({
      from: resendFromEmail(),
      to: recipient,
      subject,
      text: body,
      html: html || body.replace(/\n/g, "<br>"),
    });

    if (error) return { success: false, error: error.message };
    return { success: true, id: data?.id };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
