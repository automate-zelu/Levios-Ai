/**
 * Provider-agnostic telephony for workspace BYOT (Twilio or Telnyx).
 */

import Telnyx from "telnyx";
import { decrypt } from "./crypto.js";
import { getClientForWorkspace } from "./twilio-subaccount.js";

export type VoiceProvider = "twilio" | "telnyx";

export type TelephonyWorkspace = {
  id: string;
  voiceProvider?: string | null;
  twilioSubAccountSid?: string | null;
  twilioSubAuthToken?: string | null;
  twilioPhoneNumber?: string | null;
  telnyxApiKey?: string | null;
  telnyxConnectionId?: string | null;
  telnyxMessagingProfileId?: string | null;
  telnyxPhoneNumber?: string | null;
};

export function resolveVoiceProvider(ws: TelephonyWorkspace): VoiceProvider | null {
  const preferred = (ws.voiceProvider || "").toLowerCase();
  const twilioReady = !!(ws.twilioSubAccountSid && ws.twilioSubAuthToken && ws.twilioPhoneNumber);
  const telnyxReady = !!(ws.telnyxApiKey && ws.telnyxPhoneNumber && ws.telnyxConnectionId);

  if (preferred === "telnyx" && telnyxReady) return "telnyx";
  if (preferred === "twilio" && twilioReady) return "twilio";
  if (telnyxReady && !twilioReady) return "telnyx";
  if (twilioReady) return "twilio";
  return null;
}

export function workspacePhoneConnected(ws: TelephonyWorkspace): boolean {
  return resolveVoiceProvider(ws) !== null;
}

export function workspaceFromNumber(ws: TelephonyWorkspace): string | null {
  const provider = resolveVoiceProvider(ws);
  if (provider === "telnyx") return ws.telnyxPhoneNumber || null;
  if (provider === "twilio") return ws.twilioPhoneNumber || null;
  return null;
}

function telnyxClient(ws: TelephonyWorkspace) {
  if (!ws.telnyxApiKey) throw new Error("Telnyx API key missing for workspace");
  const apiKey = decrypt(ws.telnyxApiKey);
  return new Telnyx({ apiKey });
}

export type PlaceCallOpts = {
  to: string;
  connectUrl: string;
  statusCallback: string;
  recordingStatusCallback?: string;
  record?: boolean;
};

export type PlaceCallResult = { sid: string; provider: VoiceProvider };

export async function placeOutboundCall(
  ws: TelephonyWorkspace,
  opts: PlaceCallOpts
): Promise<PlaceCallResult> {
  const provider = resolveVoiceProvider(ws);
  if (!provider) {
    throw new Error("No voice provider connected — connect Twilio or Telnyx in SDR Setup");
  }

  if (provider === "twilio") {
    const { client, fromNumber } = getClientForWorkspace({
      twilioSubAccountSid: ws.twilioSubAccountSid || null,
      twilioSubAuthToken: ws.twilioSubAuthToken || null,
      twilioPhoneNumber: ws.twilioPhoneNumber || null,
    });
    if (!fromNumber) throw new Error("Twilio phone number not assigned");
    const call = await client.calls.create({
      to: opts.to,
      from: fromNumber,
      url: opts.connectUrl,
      statusCallback: opts.statusCallback,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      record: opts.record ?? true,
      ...(opts.recordingStatusCallback
        ? { recordingStatusCallback: opts.recordingStatusCallback }
        : {}),
    });
    return { sid: call.sid, provider };
  }

  // Telnyx TeXML outbound call (TwiML-compatible Url)
  if (!ws.telnyxConnectionId) throw new Error("Telnyx TeXML connection/application id missing");
  if (!ws.telnyxPhoneNumber) throw new Error("Telnyx phone number not assigned");

  const apiKey = decrypt(ws.telnyxApiKey!);
  const connectionId = ws.telnyxConnectionId;
  const body: Record<string, unknown> = {
    To: opts.to,
    From: ws.telnyxPhoneNumber,
    Url: opts.connectUrl,
    StatusCallback: opts.statusCallback,
    StatusCallbackMethod: "POST",
    StatusCallbackEvent: "initiated ringing answered completed",
  };
  if (opts.record !== false) {
    body.Record = true;
    if (opts.recordingStatusCallback) {
      body.RecordingStatusCallback = opts.recordingStatusCallback;
    }
  }

  const res = await fetch(`https://api.telnyx.com/v2/texml/calls/${encodeURIComponent(connectionId)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  const errDetail =
    json?.errors?.[0]?.detail ||
    json?.error?.message ||
    json?.message ||
    (!res.ok ? `Telnyx call failed (${res.status})` : null);
  // Telnyx sometimes returns 200 with an errors[] payload (e.g. account D60 limits).
  if (!res.ok || (Array.isArray(json?.errors) && json.errors.length > 0)) {
    throw new Error(errDetail || `Telnyx call failed (${res.status})`);
  }
  const sid =
    json?.data?.call_sid ||
    json?.data?.call_control_id ||
    json?.call_sid ||
    json?.sid ||
    `telnyx_${Date.now()}`;
  return { sid: String(sid), provider };
}

export type SendSmsResult = { sid: string; provider: VoiceProvider; from: string };

export async function sendOutboundSms(
  ws: TelephonyWorkspace,
  opts: { to: string; body: string }
): Promise<SendSmsResult> {
  const provider = resolveVoiceProvider(ws);
  if (!provider) {
    throw new Error("No messaging provider connected — connect Twilio or Telnyx in SDR Setup");
  }

  if (provider === "twilio") {
    const { client, fromNumber } = getClientForWorkspace({
      twilioSubAccountSid: ws.twilioSubAccountSid || null,
      twilioSubAuthToken: ws.twilioSubAuthToken || null,
      twilioPhoneNumber: ws.twilioPhoneNumber || null,
    });
    if (!fromNumber) throw new Error("Twilio phone number not assigned");
    const message = await client.messages.create({
      body: opts.body,
      from: fromNumber,
      to: opts.to,
    });
    return { sid: message.sid, provider, from: fromNumber };
  }

  if (!ws.telnyxPhoneNumber) throw new Error("Telnyx phone number not assigned");
  const client = telnyxClient(ws);
  const payload: Record<string, unknown> = {
    from: ws.telnyxPhoneNumber,
    to: opts.to,
    text: opts.body,
  };
  if (ws.telnyxMessagingProfileId) {
    payload.messaging_profile_id = ws.telnyxMessagingProfileId;
  }
  const result: any = await (client as any).messages.create(payload);
  const data = result?.data || result;
  const sid = data?.id || data?.sid || `telnyx_sms_${Date.now()}`;
  return { sid: String(sid), provider, from: ws.telnyxPhoneNumber };
}

/** Validate Telnyx API key with a lightweight authenticated request. */
export async function validateTelnyxApiKey(apiKey: string): Promise<void> {
  const res = await fetch("https://api.telnyx.com/v2/phone_numbers?page[size]=1", {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error("Invalid Telnyx API key"), { status: 401 });
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telnyx API error (${res.status}): ${text.slice(0, 200)}`);
  }
}

export async function listTelnyxPhoneNumbers(apiKey: string): Promise<
  Array<{ id: string; phoneNumber: string; friendlyName: string; connectionId: string | null }>
> {
  const res = await fetch("https://api.telnyx.com/v2/phone_numbers?page[size]=50", {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.errors?.[0]?.detail || `Failed to list Telnyx numbers (${res.status})`);
  }
  const rows = json?.data || [];
  return rows.map((n: any) => ({
    id: String(n.id),
    phoneNumber: String(n.phone_number || n.phoneNumber || ""),
    friendlyName: String(n.tags?.[0] || n.connection_name || n.phone_number || ""),
    connectionId: n.connection_id ? String(n.connection_id) : null,
  }));
}

async function telnyxJson(
  apiKey: string,
  path: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await fetch(`https://api.telnyx.com/v2${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const json: any = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

/**
 * Ensure the workspace has a TeXML application + messaging profile ready for AI calls.
 * Creates "Leviosai AI Voice" TeXML app when missing and points voice_url at BASE_URL.
 */
export async function ensureTelnyxVoiceSetup(
  apiKey: string,
  opts?: { existingConnectionId?: string | null; existingMessagingProfileId?: string | null }
): Promise<{ connectionId: string; messagingProfileId: string | null }> {
  const baseUrl = (process.env.BASE_URL || "").replace(/\/$/, "");
  const voiceUrl = baseUrl ? `${baseUrl}/api/call/connect` : undefined;
  const smsUrl = baseUrl ? `${baseUrl}/api/webhooks/telnyx/sms` : undefined;

  let connectionId = opts?.existingConnectionId || null;
  let messagingProfileId = opts?.existingMessagingProfileId || null;

  if (!connectionId) {
    const listed = await telnyxJson(apiKey, "/texml_applications?page[size]=20");
    const apps: any[] = listed.json?.data || [];
    const existing =
      apps.find((a) => /leviosai/i.test(String(a.friendly_name || ""))) || apps[0] || null;
    if (existing?.id) {
      connectionId = String(existing.id);
    } else {
      const created = await telnyxJson(apiKey, "/texml_applications", {
        method: "POST",
        body: JSON.stringify({
          friendly_name: "Leviosai AI Voice",
          ...(voiceUrl
            ? { voice_url: voiceUrl, voice_method: "POST", status_callback: `${baseUrl}/api/webhooks/twilio/call-status`, status_callback_method: "POST" }
            : {}),
        }),
      });
      if (!created.ok || !created.json?.data?.id) {
        throw new Error(
          created.json?.errors?.[0]?.detail || "Failed to create Telnyx TeXML application"
        );
      }
      connectionId = String(created.json.data.id);
    }
  }

  // Attach outbound voice profile when available (required for outbound TeXML dial).
  const profiles = await telnyxJson(apiKey, "/outbound_voice_profiles?page[size]=5");
  const profileId = profiles.json?.data?.[0]?.id ? String(profiles.json.data[0].id) : null;
  if (profileId && connectionId) {
    await telnyxJson(apiKey, `/texml_applications/${encodeURIComponent(connectionId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        outbound: { outbound_voice_profile_id: profileId },
        ...(voiceUrl
          ? { voice_url: voiceUrl, voice_method: "POST" }
          : {}),
      }),
    });
  }

  if (!messagingProfileId) {
    const mp = await telnyxJson(apiKey, "/messaging_profiles?page[size]=10");
    const first = mp.json?.data?.[0];
    if (first?.id) {
      messagingProfileId = String(first.id);
      if (smsUrl) {
        await telnyxJson(apiKey, `/messaging_profiles/${encodeURIComponent(messagingProfileId)}`, {
          method: "PATCH",
          body: JSON.stringify({ webhook_url: smsUrl, webhook_api_version: "2" }),
        });
      }
    }
  }

  return { connectionId: connectionId!, messagingProfileId };
}

/** Bind a purchased Telnyx number to the TeXML application used for AI calls. */
export async function assignTelnyxNumberToConnection(
  apiKey: string,
  phoneId: string,
  connectionId: string
): Promise<void> {
  const res = await telnyxJson(apiKey, `/phone_numbers/${encodeURIComponent(phoneId)}`, {
    method: "PATCH",
    body: JSON.stringify({ connection_id: connectionId }),
  });
  if (!res.ok) {
    throw new Error(res.json?.errors?.[0]?.detail || `Failed to assign Telnyx number (${res.status})`);
  }
}

