import twilio from "twilio";
import "dotenv/config";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;

let client: twilio.Twilio | null = null;

function getClient() {
  if (!client && accountSid && authToken) {
    client = twilio(accountSid, authToken);
  }
  return client;
}

export function isTwilioConfigured(): boolean {
  return !!(accountSid && authToken && fromNumber);
}

export async function sendSMS(to: string, body: string): Promise<{ success: boolean; sid?: string; error?: string }> {
  const c = getClient();
  if (!c || !fromNumber) {
    return { success: false, error: "Twilio not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env" };
  }
  try {
    const message = await c.messages.create({ body, from: fromNumber, to });
    return { success: true, sid: message.sid };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function initiateCall(to: string, twimlUrl?: string): Promise<{ success: boolean; sid?: string; error?: string }> {
  const c = getClient();
  if (!c || !fromNumber) {
    return { success: false, error: "Twilio not configured" };
  }
  try {
    const call = await c.calls.create({
      from: fromNumber,
      to,
      url: twimlUrl || "http://demo.twilio.com/docs/voice.xml",
    });
    return { success: true, sid: call.sid };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function getMessageStatus(sid: string): Promise<any> {
  const c = getClient();
  if (!c) return { error: "Twilio not configured" };
  try {
    const msg = await c.messages(sid).fetch();
    return { sid: msg.sid, status: msg.status, dateCreated: msg.dateCreated };
  } catch (err: any) {
    return { error: err.message };
  }
}
