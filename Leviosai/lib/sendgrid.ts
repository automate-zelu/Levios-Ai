import sgMail from "@sendgrid/mail";
import "dotenv/config";

const apiKey = process.env.SENDGRID_API_KEY;
const fromEmail = process.env.SENDGRID_FROM_EMAIL || "noreply@leviosai.com";

if (apiKey) {
  sgMail.setApiKey(apiKey);
}

export function isSendGridConfigured(): boolean {
  return !!apiKey;
}

export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  html?: string
): Promise<{ success: boolean; error?: string }> {
  const { resolveEmailDelivery } = await import("./email-delivery.js");
  const plan = resolveEmailDelivery(to);
  if (plan.skipped) {
    console.log(`[email] skipped (${plan.reason}): ${subject}`);
    return { success: true };
  }
  const recipient = plan.recipients[0];
  if (!recipient) {
    return { success: false, error: "no_recipient" };
  }

  if (!apiKey) {
    return { success: false, error: "SendGrid not configured. Set SENDGRID_API_KEY in .env" };
  }

  try {
    await sgMail.send({
      to: recipient,
      from: fromEmail,
      subject,
      text: body,
      html: html || body.replace(/\n/g, "<br>"),
    });
    return { success: true };
  } catch (err: any) {
    const message = err.response?.body?.errors?.[0]?.message || err.message;
    return { success: false, error: message };
  }
}

export async function sendTemplateEmail(
  to: string,
  templateId: string,
  dynamicData: Record<string, any>
): Promise<{ success: boolean; error?: string }> {
  if (!apiKey) {
    return { success: false, error: "SendGrid not configured" };
  }

  try {
    await sgMail.send({
      to,
      from: fromEmail,
      templateId,
      dynamicTemplateData: dynamicData,
    });
    return { success: true };
  } catch (err: any) {
    const message = err.response?.body?.errors?.[0]?.message || err.message;
    return { success: false, error: message };
  }
}
