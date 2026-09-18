/**
 * Legacy env-based Twilio helpers — disabled.
 *
 * All calling/SMS must use workspace BYOT credentials via
 * `getClientForWorkspace` (lib/twilio-subaccount.ts). Platform .env
 * TWILIO_* keys are not used for customer traffic.
 */

export function isTwilioConfigured(): boolean {
  return false;
}

export async function sendSMS(
  _to: string,
  _body: string
): Promise<{ success: boolean; sid?: string; error?: string }> {
  return {
    success: false,
    error: "Platform Twilio env is disabled — connect Twilio on the workspace (BYOT)",
  };
}

export async function initiateCall(
  _to: string,
  _twimlUrl?: string
): Promise<{ success: boolean; sid?: string; error?: string }> {
  return {
    success: false,
    error: "Platform Twilio env is disabled — connect Twilio on the workspace (BYOT)",
  };
}

export async function getMessageStatus(_sid: string): Promise<any> {
  return { error: "Platform Twilio env is disabled — use workspace BYOT credentials" };
}
