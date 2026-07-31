// ─── TWILIO BYOT (Bring Your Own Twilio) ─────────────────────────────────────
// Client-facing routes — each workspace connects its own Twilio account.
// Credentials are encrypted at rest using AES-256 (lib/crypto.ts).

import { Router, Request, Response } from "express";
import twilio from "twilio";
import { requireAuth } from "./auth.js";
import { db } from "../lib/db.js";
import { workspaces } from "../lib/schema.js";
import { eq } from "drizzle-orm";
import { encrypt, decrypt } from "../lib/crypto.js";

const router = Router();
router.use("/api/twilio", requireAuth);

// ─── helpers ─────────────────────────────────────────────────────────────────

async function getWorkspace(workspaceId: string) {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  return ws ?? null;
}

function clientFromWorkspace(ws: any) {
  if (!ws.twilioSubAccountSid || !ws.twilioSubAuthToken) return null;
  return twilio(decrypt(ws.twilioSubAccountSid), decrypt(ws.twilioSubAuthToken));
}

// ─── GET /api/twilio/status ───────────────────────────────────────────────────
// Returns connection status and masked phone number for the workspace.

router.get("/api/twilio/status", async (req: Request, res: Response) => {
  try {
    const ws = await getWorkspace((req as any).workspaceId);
    if (!ws) return res.status(404).json({ error: "Workspace not found" });

    const connected = !!(ws.twilioSubAccountSid && ws.twilioSubAuthToken);
    res.json({
      connected,
      phoneNumber:    ws.twilioPhoneNumber ?? null,
      accountSidMasked: connected
        ? decrypt(ws.twilioSubAccountSid!).slice(0, 4) + "••••••••••••••••••••••••••••" + decrypt(ws.twilioSubAccountSid!).slice(-4)
        : null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/twilio/connect ─────────────────────────────────────────────────
// Saves and validates the client's own Twilio credentials.
// Body: { accountSid, authToken }

router.post("/api/twilio/connect", async (req: Request, res: Response) => {
  try {
    const { accountSid, authToken } = req.body;
    if (!accountSid || !authToken) {
      return res.status(400).json({ error: "accountSid and authToken are required" });
    }

    // Validate credentials by making a lightweight API call
    const client = twilio(accountSid, authToken);
    await client.api.v2010.accounts(accountSid).fetch();

    const ws = await getWorkspace((req as any).workspaceId);
    if (!ws) return res.status(404).json({ error: "Workspace not found" });

    await db.update(workspaces).set({
      twilioSubAccountSid: encrypt(accountSid),
      twilioSubAuthToken:  encrypt(authToken),
      updatedAt: new Date(),
    }).where(eq(workspaces.id, ws.id));

    res.json({
      connected: true,
      accountSidMasked: accountSid.slice(0, 4) + "••••••••••••••••••••••••••••" + accountSid.slice(-4),
    });
  } catch (err: any) {
    // Twilio auth errors come back as 20003
    if (err.code === 20003 || err.status === 401) {
      return res.status(401).json({ error: "Invalid Twilio credentials. Check your Account SID and Auth Token." });
    }
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/twilio/connect ───────────────────────────────────────────────
// Disconnects (clears credentials from DB). Does not touch Twilio itself.

router.delete("/api/twilio/connect", async (req: Request, res: Response) => {
  try {
    const ws = await getWorkspace((req as any).workspaceId);
    if (!ws) return res.status(404).json({ error: "Workspace not found" });

    await db.update(workspaces).set({
      twilioSubAccountSid: null,
      twilioSubAuthToken:  null,
      twilioPhoneNumber:   null,
      twilioPhoneSid:      null,
      updatedAt: new Date(),
    }).where(eq(workspaces.id, ws.id));

    res.json({ connected: false });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/twilio/numbers/existing ────────────────────────────────────────
// Lists all phone numbers already purchased in the client's Twilio account.

router.get("/api/twilio/numbers/existing", async (req: Request, res: Response) => {
  try {
    const ws = await getWorkspace((req as any).workspaceId);
    if (!ws) return res.status(404).json({ error: "Workspace not found" });

    const client = clientFromWorkspace(ws);
    if (!client) return res.status(400).json({ error: "Twilio not connected — add credentials first" });

    const numbers = await client.incomingPhoneNumbers.list({ limit: 50 });

    res.json(numbers.map(n => ({
      sid:          n.sid,
      phoneNumber:  n.phoneNumber,
      friendlyName: n.friendlyName,
      locality:     (n as any).locality || "",
      region:       (n as any).region   || "",
      inUse:        ws.twilioPhoneNumber === n.phoneNumber,
      capabilities: {
        voice: n.capabilities?.voice ?? true,
        sms:   n.capabilities?.sms   ?? true,
        mms:   n.capabilities?.mms   ?? false,
      },
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/twilio/numbers/use ────────────────────────────────────────────
// Assign an already-purchased number to this workspace (no charge).
// Configures Twilio webhooks on the number and saves to workspace.
// Body: { phoneNumber: "+14155551234", sid: "PN..." }

router.post("/api/twilio/numbers/use", async (req: Request, res: Response) => {
  try {
    const { phoneNumber, sid: phoneSid } = req.body;
    if (!phoneNumber || !phoneSid) return res.status(400).json({ error: "phoneNumber and sid are required" });

    const ws = await getWorkspace((req as any).workspaceId);
    if (!ws) return res.status(404).json({ error: "Workspace not found" });

    const client = clientFromWorkspace(ws);
    if (!client) return res.status(400).json({ error: "Twilio not connected — add credentials first" });

    const baseUrl  = process.env.BASE_URL;
    const isPublic = baseUrl && !baseUrl.includes("localhost") && !baseUrl.includes("127.0.0.1");

    if (isPublic) {
      await client.incomingPhoneNumbers(phoneSid).update({
        voiceUrl:    `${baseUrl}/api/call/connect`,
        voiceMethod: "POST",
        smsUrl:      `${baseUrl}/api/webhooks/twilio/sms`,
        smsMethod:   "POST",
      });
    }

    await db.update(workspaces).set({
      twilioPhoneNumber: phoneNumber,
      twilioPhoneSid:    phoneSid,
      updatedAt: new Date(),
    }).where(eq(workspaces.id, ws.id));

    res.json({ phoneNumber, phoneSid });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/twilio/numbers ──────────────────────────────────────────────────
// Search available phone numbers in the client's Twilio account.
// Query params:
//   type       local | toll-free | mobile   (default: local)
//   areaCode   3-digit area code            (local only)
//   contains   digit/letter pattern         e.g. "888" or "***-555-****"
//   inRegion   US state abbreviation        e.g. "CA"
//   inPostalCode  zip code                  e.g. "94105"
//   smsEnabled    true|false
//   voiceEnabled  true|false
//   mmsEnabled    true|false
//   limit      1–30 (default 20)

router.get("/api/twilio/numbers", async (req: Request, res: Response) => {
  try {
    const ws = await getWorkspace((req as any).workspaceId);
    if (!ws) return res.status(404).json({ error: "Workspace not found" });

    const client = clientFromWorkspace(ws);
    if (!client) return res.status(400).json({ error: "Twilio not connected — add credentials first" });

    const {
      areaCode     = "",
      contains     = "",
      inRegion     = "",
      inPostalCode = "",
      limit        = "20",
    } = req.query as Record<string, string>;

    const params: Record<string, any> = {
      limit:        Math.min(30, parseInt(limit, 10)),
      voiceEnabled: true,
      smsEnabled:   true,
    };
    if (areaCode)     params.areaCode     = parseInt(areaCode, 10);
    if (contains)     params.contains     = contains;
    if (inRegion)     params.inRegion     = inRegion.toUpperCase();
    if (inPostalCode) params.inPostalCode = inPostalCode;

    const results = await client.availablePhoneNumbers("US").local.list(params);

    res.json(results.map((n: any) => ({
      phoneNumber:  n.phoneNumber,
      friendlyName: n.friendlyName,
      locality:     n.locality || "",
      region:       n.region   || "",
      postalCode:   n.postalCode || "",
      capabilities: {
        voice: n.capabilities?.voice ?? true,
        sms:   n.capabilities?.sms   ?? true,
        mms:   n.capabilities?.mms   ?? false,
      },
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/twilio/numbers/purchase ───────────────────────────────────────
// Purchase a specific number chosen by the user.
// Body: { phoneNumber: "+14155551234" }

router.post("/api/twilio/numbers/purchase", async (req: Request, res: Response) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: "phoneNumber is required" });

    const ws = await getWorkspace((req as any).workspaceId);
    if (!ws) return res.status(404).json({ error: "Workspace not found" });

    const client = clientFromWorkspace(ws);
    if (!client) return res.status(400).json({ error: "Twilio not connected — add credentials first" });

    const baseUrl   = process.env.BASE_URL;
    const isPublic  = baseUrl && !baseUrl.includes("localhost") && !baseUrl.includes("127.0.0.1");

    const purchased = await client.incomingPhoneNumbers.create({
      phoneNumber,
      ...(isPublic && {
        voiceUrl:    `${baseUrl}/api/call/connect`,
        voiceMethod: "POST",
        smsUrl:      `${baseUrl}/api/webhooks/twilio/sms`,
        smsMethod:   "POST",
      }),
    });

    await db.update(workspaces).set({
      twilioPhoneNumber: purchased.phoneNumber,
      twilioPhoneSid:    purchased.sid,
      updatedAt: new Date(),
    }).where(eq(workspaces.id, ws.id));

    res.json({ phoneNumber: purchased.phoneNumber, phoneSid: purchased.sid });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/twilio/number ────────────────────────────────────────────────
// Release (remove) the purchased number from the workspace.

router.delete("/api/twilio/number", async (req: Request, res: Response) => {
  try {
    const ws = await getWorkspace((req as any).workspaceId);
    if (!ws) return res.status(404).json({ error: "Workspace not found" });

    if (ws.twilioPhoneSid) {
      const client = clientFromWorkspace(ws);
      if (client) {
        try {
          await client.incomingPhoneNumbers(ws.twilioPhoneSid).remove();
        } catch { /* number may already be gone */ }
      }
    }

    await db.update(workspaces).set({
      twilioPhoneNumber: null,
      twilioPhoneSid:    null,
      updatedAt: new Date(),
    }).where(eq(workspaces.id, ws.id));

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/twilio/number/unassign ────────────────────────────────────────
// Removes the number from the workspace without releasing it from Twilio.
// Useful when the user wants to switch to a different number they own.

router.post("/api/twilio/number/unassign", async (req: Request, res: Response) => {
  try {
    const ws = await getWorkspace((req as any).workspaceId);
    if (!ws) return res.status(404).json({ error: "Workspace not found" });

    await db.update(workspaces).set({
      twilioPhoneNumber: null,
      twilioPhoneSid:    null,
      updatedAt: new Date(),
    }).where(eq(workspaces.id, ws.id));

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
