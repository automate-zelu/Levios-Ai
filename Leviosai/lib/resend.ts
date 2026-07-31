import { Resend } from "resend";
import "dotenv/config";

const apiKey = process.env.RESEND_API_KEY;
const fromEmail = process.env.RESEND_FROM_EMAIL || "christian@leviosai.io";

const client = apiKey ? new Resend(apiKey) : null;

export function isResendConfigured(): boolean {
  return !!apiKey;
}

export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  html?: string
): Promise<{ success: boolean; id?: string; error?: string }> {
  if (!client) {
    return { success: false, error: "Resend not configured. Set RESEND_API_KEY in .env" };
  }

  try {
    const { data, error } = await client.emails.send({
      from: fromEmail,
      to,
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
