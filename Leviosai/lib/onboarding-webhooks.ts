/**
 * Outbound webhooks to Anthony’s onboarding app (P5).
 * Set ONBOARDING_APP_WEBHOOK_URL (+ optional ONBOARDING_APP_WEBHOOK_SECRET).
 */

import {
  buildOutboundWebhookPayload,
  type OutboundEventType,
} from "./onboarding-handoff.js";

export async function emitOnboardingAppWebhook(input: {
  type: OutboundEventType;
  organizationId: number;
  workspaceId?: string | null;
  userId?: number | null;
  email?: string | null;
  externalOrgId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<{ sent: boolean; reason?: string }> {
  const url = process.env.ONBOARDING_APP_WEBHOOK_URL?.trim();
  if (!url) return { sent: false, reason: "ONBOARDING_APP_WEBHOOK_URL not set" };

  const payload = buildOutboundWebhookPayload(input);
  const secret = process.env.ONBOARDING_APP_WEBHOOK_SECRET?.trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Catalyst-Onboarding-Webhook/1.0",
  };
  if (secret) headers["X-Catalyst-Webhook-Secret"] = secret;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`Onboarding webhook ${input.type} → ${res.status}`);
      return { sent: false, reason: `HTTP ${res.status}` };
    }
    return { sent: true };
  } catch (err: any) {
    console.error(`Onboarding webhook ${input.type} failed:`, err?.message || err);
    return { sent: false, reason: err?.message || "fetch failed" };
  }
}
