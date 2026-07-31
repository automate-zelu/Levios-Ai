// ─── TWILIO SUB-ACCOUNT MANAGER ───────────────────────────────────────────────
// Creates, configures, and releases Twilio sub-accounts per workspace.
//
// Each workspace (client) gets an isolated Twilio sub-account so that:
//   - Spam/compliance issues on one client cannot affect others
//   - Per-client Twilio spend is trackable and markable up
//   - Calls and SMS appear from the client's own provisioned number
//   - Clients never need to touch Twilio directly
//
// Credentials are AES-256 encrypted before DB storage (lib/crypto.ts).
// The master account credentials live only in env vars — never in the DB.
//
// Required env vars:
//   TWILIO_MASTER_SID          — Leviosai's master Twilio account SID
//   TWILIO_MASTER_AUTH_TOKEN   — Leviosai's master Twilio auth token
//   BASE_URL                   — Public URL for Twilio webhook callbacks
//   ENCRYPTION_KEY             — 64-char hex key for credential encryption

import twilio from "twilio";
import { db } from "./db.js";
import { workspaces } from "./schema.js";
import { eq } from "drizzle-orm";
import { encrypt, decrypt } from "./crypto.js";

// ─── MASTER CLIENT ────────────────────────────────────────────────────────────

function getMasterClient(): twilio.Twilio {
  const sid = process.env.TWILIO_MASTER_SID;
  const token = process.env.TWILIO_MASTER_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error(
      "TWILIO_MASTER_SID and TWILIO_MASTER_AUTH_TOKEN are required for sub-account provisioning"
    );
  }
  return twilio(sid, token);
}

// ─── PROVISION ────────────────────────────────────────────────────────────────
// Creates a sub-account + purchases a local number, stores encrypted creds.
// Called automatically from the Stripe subscription.created webhook,
// and manually from POST /api/admin/workspaces/:id/provision-twilio.

export async function provisionWorkspace(
  workspaceId: string,
  workspaceName: string,
): Promise<{ subAccountSid: string }> {
  const master = getMasterClient();

  // Create an isolated sub-account for this workspace.
  // Phone numbers are assigned separately via assignPhoneNumber().
  const subAccount = await master.api.v2010.accounts.create({
    friendlyName: `Leviosai — ${workspaceName}`,
  });

  // Persist encrypted sub-account credentials
  await db
    .update(workspaces)
    .set({
      twilioSubAccountSid: encrypt(subAccount.sid),
      twilioSubAuthToken:  encrypt(subAccount.authToken),
      twilioPhoneNumber:   null,
      twilioPhoneSid:      null,
      updatedAt:           new Date(),
    })
    .where(eq(workspaces.id, workspaceId));

  console.log(`✅ Twilio sub-account created for workspace ${workspaceId}: ${subAccount.sid}`);

  return { subAccountSid: subAccount.sid };
}

// ─── SEARCH AVAILABLE NUMBERS ────────────────────────────────────────────────
// Returns available local numbers for the workspace's sub-account to preview
// before purchasing. No charge — just a search.

export async function searchAvailableNumbers(
  workspaceId: string,
  areaCode = "",
  limit = 10
): Promise<Array<{ phoneNumber: string; friendlyName: string; locality: string; region: string; capabilities: { voice: boolean; sms: boolean; mms: boolean } }>> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws?.twilioSubAccountSid || !ws?.twilioSubAuthToken) {
    throw new Error("Sub-account not provisioned — create sub-account first");
  }

  const subClient = twilio(decrypt(ws.twilioSubAccountSid), decrypt(ws.twilioSubAuthToken));
  const params: Record<string, any> = { limit };
  if (areaCode) params.areaCode = parseInt(areaCode, 10);

  const results = await subClient.availablePhoneNumbers("US").local.list(params);

  return results.map(n => ({
    phoneNumber:  n.phoneNumber,
    friendlyName: n.friendlyName,
    locality:     n.locality || "",
    region:       n.region || "",
    capabilities: {
      voice: n.capabilities?.voice ?? true,
      sms:   n.capabilities?.sms ?? true,
      mms:   n.capabilities?.mms ?? false,
    },
  }));
}

// ─── ASSIGN PHONE NUMBER ──────────────────────────────────────────────────────
// Purchases a local number under the workspace's sub-account and stores it.
// Called separately after sub-account creation.

export async function assignPhoneNumber(
  workspaceId: string,
  phoneNumber: string  // specific number selected by admin from search results
): Promise<{ phoneNumber: string; phoneSid: string }> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws?.twilioSubAccountSid || !ws?.twilioSubAuthToken) {
    throw new Error("Sub-account not provisioned for this workspace — provision first");
  }

  const baseUrl = process.env.BASE_URL;
  const isPublic = baseUrl && !baseUrl.includes("localhost") && !baseUrl.includes("127.0.0.1");

  const subClient = twilio(decrypt(ws.twilioSubAccountSid), decrypt(ws.twilioSubAuthToken));

  const purchased = await subClient.incomingPhoneNumbers.create({
    phoneNumber,
    ...(isPublic && {
      voiceUrl:    `${baseUrl}/api/call/connect`,
      voiceMethod: "POST",
      smsUrl:      `${baseUrl}/api/webhooks/twilio/sms`,
      smsMethod:   "POST",
    }),
  });

  await db
    .update(workspaces)
    .set({ twilioPhoneNumber: purchased.phoneNumber, twilioPhoneSid: purchased.sid, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId));

  console.log(`✅ Phone number ${purchased.phoneNumber} assigned to workspace ${workspaceId}`);
  return { phoneNumber: purchased.phoneNumber, phoneSid: purchased.sid };
}

// ─── GET CLIENT ───────────────────────────────────────────────────────────────
// Returns a Twilio client authenticated to the workspace's sub-account.
// Used by call-orchestrator.ts and sdr-queue.ts SEND_SMS handler.

export function getWorkspaceTwilioClient(workspace: {
  twilioSubAccountSid: string | null;
  twilioSubAuthToken:  string | null;
}): twilio.Twilio {
  if (!workspace.twilioSubAccountSid || !workspace.twilioSubAuthToken) {
    throw new Error("Twilio sub-account not provisioned for this workspace");
  }
  return twilio(
    decrypt(workspace.twilioSubAccountSid),
    decrypt(workspace.twilioSubAuthToken)
  );
}

// ─── FALLBACK CLIENT ─────────────────────────────────────────────────────────
// Returns workspace sub-account client if provisioned, otherwise falls back
// to the master account. Used during migration / dev so calls still work
// before sub-accounts are provisioned.

export function getClientForWorkspace(workspace: {
  twilioSubAccountSid: string | null;
  twilioSubAuthToken:  string | null;
}): { client: twilio.Twilio; fromNumber: string | null } {
  if (workspace.twilioSubAccountSid && workspace.twilioSubAuthToken) {
    return {
      client:     getWorkspaceTwilioClient(workspace),
      fromNumber: (workspace as any).twilioPhoneNumber ?? null,
    };
  }
  // Fallback: master account (dev / pre-provisioning)
  const sid   = process.env.TWILIO_MASTER_SID   || process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_MASTER_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error("No Twilio credentials available for this workspace");
  return {
    client:     twilio(sid, token),
    fromNumber: process.env.TWILIO_PHONE_NUMBER ?? null,
  };
}

// ─── SUSPEND / CLOSE SUB-ACCOUNT ─────────────────────────────────────────────
// suspend=false (default) → status: "suspended" — can be reactivated later
// suspend=false, permanent=true → status: "closed"  — irreversible, all data deleted
//
// Both clear the workspace credentials from the DB so the admin can re-provision.

export async function releaseWorkspace(workspaceId: string, permanent = false): Promise<void> {
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));

  if (!ws?.twilioSubAccountSid) {
    console.log(`releaseWorkspace: workspace ${workspaceId} has no sub-account — nothing to do`);
    return;
  }

  const subSid = decrypt(ws.twilioSubAccountSid);
  const master = getMasterClient();
  const action = permanent ? "closed" : "suspended";

  try {
    await master.api.v2010.accounts(subSid).update({ status: action as any });
    console.log(`✅ Twilio sub-account ${subSid} ${action} for workspace ${workspaceId}`);
  } catch (err: any) {
    // Log but don't throw — still clear the DB row so admin can re-provision
    console.error(`⚠️  Failed to ${action} Twilio sub-account ${subSid}:`, err.message);
  }

  await db
    .update(workspaces)
    .set({
      twilioSubAccountSid: null,
      twilioSubAuthToken:  null,
      twilioPhoneNumber:   null,
      twilioPhoneSid:      null,
      updatedAt:           new Date(),
    })
    .where(eq(workspaces.id, workspaceId));
}

// ─── STATUS ───────────────────────────────────────────────────────────────────
// Returns provisioning status for a workspace (used by admin panel).

export async function getTwilioStatus(workspaceId: string): Promise<{
  provisioned: boolean;
  hasSubAccount: boolean;
  phoneNumber: string | null;
  subAccountSidMasked: string | null;
}> {
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));

  if (!ws) throw new Error("Workspace not found");

  const hasSubAccount = !!ws.twilioSubAccountSid;
  const provisioned   = !!(ws.twilioSubAccountSid && ws.twilioPhoneNumber);
  let subAccountSidMasked: string | null = null;

  if (ws.twilioSubAccountSid) {
    const sid = decrypt(ws.twilioSubAccountSid);
    subAccountSidMasked = sid.slice(0, 4) + "••••••••••" + sid.slice(-6);
  }

  return {
    hasSubAccount,
    provisioned,
    phoneNumber:         ws.twilioPhoneNumber ?? null,
    subAccountSidMasked,
  };
}
