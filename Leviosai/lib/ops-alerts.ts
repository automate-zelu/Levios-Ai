// ─── Ops alerts (IMPLEMENTATION_PLAN — Twilio provision failure email) ───────

import { sendEmail, isResendConfigured } from "./resend.js";

export function getOpsAlertEmail(): string | null {
  const email = (process.env.OPS_ALERT_EMAIL || "").trim();
  return email || null;
}

export function isOpsEmailAlertConfigured(): boolean {
  return isResendConfigured() && !!getOpsAlertEmail();
}

export function buildTwilioProvisionFailureEmail(input: {
  workspaceId: string;
  workspaceName: string;
  organizationId?: number | null;
  errorMessage: string;
  baseUrl?: string;
}): { subject: string; text: string; html: string } {
  const base = (input.baseUrl || process.env.BASE_URL || "").replace(/\/$/, "");
  const adminPath = base ? `${base}/admin` : "/admin";
  const subject = `[Leviosai] Twilio provision failed — ${input.workspaceName}`;
  const text = [
    "Twilio auto-provisioning failed after subscription activation.",
    "",
    `Workspace: ${input.workspaceName}`,
    `Workspace ID: ${input.workspaceId}`,
    input.organizationId != null ? `Organization ID: ${input.organizationId}` : null,
    `Error: ${input.errorMessage}`,
    "",
    "Calling is disabled for this workspace until Twilio is provisioned.",
    `Open Admin → Workspaces → provision Twilio manually: ${adminPath}`,
  ]
    .filter((line) => line != null)
    .join("\n");

  const html = `
    <p><strong>Twilio auto-provisioning failed</strong> after subscription activation.</p>
    <ul>
      <li><strong>Workspace:</strong> ${escapeHtml(input.workspaceName)}</li>
      <li><strong>Workspace ID:</strong> <code>${escapeHtml(input.workspaceId)}</code></li>
      ${
        input.organizationId != null
          ? `<li><strong>Organization ID:</strong> ${input.organizationId}</li>`
          : ""
      }
      <li><strong>Error:</strong> ${escapeHtml(input.errorMessage)}</li>
    </ul>
    <p>Calling stays disabled until Twilio is provisioned.</p>
    <p><a href="${escapeHtml(adminPath)}">Open Admin panel</a> → Workspaces → Provision Twilio.</p>
  `.trim();

  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Email Leviosai ops when Stripe auto-provision fails.
 * Never throws — alert failure must not break the billing webhook.
 */
export async function notifyTwilioProvisionFailed(input: {
  workspaceId: string;
  workspaceName: string;
  organizationId?: number | null;
  errorMessage: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const to = getOpsAlertEmail();
  if (!to) {
    console.warn("OPS_ALERT_EMAIL not set — skipping Twilio provision failure email");
    return { sent: false, reason: "OPS_ALERT_EMAIL not set" };
  }
  if (!isResendConfigured()) {
    console.warn("Resend not configured — skipping Twilio provision failure email");
    return { sent: false, reason: "Resend not configured" };
  }

  const { subject, text, html } = buildTwilioProvisionFailureEmail(input);
  const result = await sendEmail(to, subject, text, html);
  if (!result.success) {
    console.error("Ops alert email failed:", result.error);
    return { sent: false, reason: result.error };
  }
  console.log(`📧 Ops alert emailed to ${to} for workspace ${input.workspaceId}`);
  return { sent: true };
}
