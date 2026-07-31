// ─── Send email via the workspace owner's connected Gmail (Gmail API) ────────

import { GMAIL_API } from "./oauth.js";
import { getValidGmailAccessToken } from "./tokens.js";

function buildRawMime(opts: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}): string {
  const boundary = `levios_${Date.now()}`;
  const subjectEncoded = `=?UTF-8?B?${Buffer.from(opts.subject, "utf8").toString("base64")}?=`;

  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${subjectEncoded}`,
    "MIME-Version: 1.0",
  ];

  if (opts.html) {
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`, "", `--${boundary}`);
    lines.push("Content-Type: text/plain; charset=UTF-8", "", opts.text, "", `--${boundary}`);
    lines.push("Content-Type: text/html; charset=UTF-8", "", opts.html, "", `--${boundary}--`);
  } else {
    lines.push("Content-Type: text/plain; charset=UTF-8", "", opts.text);
  }

  return lines.join("\r\n");
}

function toBase64Url(raw: string): string {
  return Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Send SDR follow-up email from the organization's connected Gmail account.
 * Mirrors Twilio BYOT: the customer sends from their own channel, not platform Resend.
 */
export async function sendEmailViaGmail(
  organizationId: number,
  to: string,
  subject: string,
  body: string,
  html?: string
): Promise<{ success: boolean; id?: string; error?: string; from?: string }> {
  if (!to) {
    return { success: false, error: "Lead has no email address" };
  }

  const auth = await getValidGmailAccessToken(organizationId);
  if (!auth) {
    return {
      success: false,
      error: "Gmail not connected. Connect your Gmail on SDR Setup to send follow-up emails.",
    };
  }

  const from = auth.accountEmail || "me";
  const raw = toBase64Url(
    buildRawMime({
      from,
      to,
      subject,
      text: body,
      html: html || body.replace(/\n/g, "<br>"),
    })
  );

  try {
    const res = await fetch(`${GMAIL_API}/users/me/messages/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        success: false,
        error: data.error?.message || data.error || `Gmail send failed (${res.status})`,
      };
    }
    return { success: true, id: data.id as string | undefined, from };
  } catch (err: any) {
    return { success: false, error: err.message || "Gmail send failed" };
  }
}
