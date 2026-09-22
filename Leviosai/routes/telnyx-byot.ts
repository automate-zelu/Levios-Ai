// ─── TELNYX BYOT (Bring Your Own Telnyx) ─────────────────────────────────────
// Client-facing routes — each workspace connects its own Telnyx account.
// Credentials are encrypted at rest (lib/crypto.ts).

import { Router, Request, Response } from "express";
import { requireAuth } from "./auth.js";
import { db } from "../lib/db.js";
import { workspaces } from "../lib/schema.js";
import { eq } from "drizzle-orm";
import { encrypt, decrypt } from "../lib/crypto.js";
import {
  assignTelnyxNumberToConnection,
  ensureTelnyxVoiceSetup,
  listTelnyxPhoneNumbers,
  sendOutboundSms,
  validateTelnyxApiKey,
} from "../lib/telephony.js";

const router = Router();
router.use("/api/telnyx", requireAuth);

async function getWorkspace(workspaceId: string) {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  return ws ?? null;
}

function maskKey(key: string): string {
  if (key.length < 12) return "••••••••";
  return key.slice(0, 6) + "••••••••••••" + key.slice(-4);
}

// ─── GET /api/telnyx/status ───────────────────────────────────────────────────

router.get("/api/telnyx/status", async (req: Request, res: Response) => {
  try {
    const ws = await getWorkspace((req as any).workspaceId);
    if (!ws) return res.status(404).json({ error: "Workspace not found" });

    const connected = !!ws.telnyxApiKey;
    res.json({
      connected,
      active: ws.voiceProvider === "telnyx",
      phoneNumber: ws.telnyxPhoneNumber ?? null,
      connectionId: ws.telnyxConnectionId ?? null,
      messagingProfileId: ws.telnyxMessagingProfileId ?? null,
      apiKeyMasked: connected ? maskKey(decrypt(ws.telnyxApiKey!)) : null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/telnyx/connect ─────────────────────────────────────────────────
// Body: { apiKey, connectionId?, messagingProfileId? }

router.post("/api/telnyx/connect", async (req: Request, res: Response) => {
  try {
    const apiKey = String(req.body?.apiKey || "").trim();
    let connectionId = String(req.body?.connectionId || "").trim() || null;
    let messagingProfileId = String(req.body?.messagingProfileId || "").trim() || null;

    if (!apiKey) return res.status(400).json({ error: "apiKey is required" });

    await validateTelnyxApiKey(apiKey);

    const ws = await getWorkspace((req as any).workspaceId);
    if (!ws) return res.status(404).json({ error: "Workspace not found" });

    // Auto-create / attach TeXML app + messaging profile so users can dial after picking a number.
    const setup = await ensureTelnyxVoiceSetup(apiKey, {
      existingConnectionId: connectionId ?? ws.telnyxConnectionId,
      existingMessagingProfileId: messagingProfileId ?? ws.telnyxMessagingProfileId,
    });
    connectionId = setup.connectionId;
    messagingProfileId = setup.messagingProfileId ?? messagingProfileId;

    await db
      .update(workspaces)
      .set({
        telnyxApiKey: encrypt(apiKey),
        telnyxConnectionId: connectionId,
        telnyxMessagingProfileId: messagingProfileId,
        voiceProvider: "telnyx",
        updatedAt: new Date(),
      })
      .where(eq(workspaces.id, ws.id));

    res.json({
      connected: true,
      active: true,
      apiKeyMasked: maskKey(apiKey),
      connectionId,
      messagingProfileId,
    });
  } catch (err: any) {
    if (err.status === 401) {
      return res.status(401).json({ error: "Invalid Telnyx API key" });
    }
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/telnyx/connect ───────────────────────────────────────────────

router.delete("/api/telnyx/connect", async (req: Request, res: Response) => {
  try {
    const ws = await getWorkspace((req as any).workspaceId);
    if (!ws) return res.status(404).json({ error: "Workspace not found" });

    await db
      .update(workspaces)
      .set({
        telnyxApiKey: null,
        telnyxConnectionId: null,
        telnyxMessagingProfileId: null,
        telnyxPhoneNumber: null,
        telnyxPhoneId: null,
        voiceProvider: ws.voiceProvider === "telnyx" ? (ws.twilioSubAccountSid ? "twilio" : null) : ws.voiceProvider,
        updatedAt: new Date(),
      })
      .where(eq(workspaces.id, ws.id));

    res.json({ connected: false });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/telnyx/activate ────────────────────────────────────────────────
// Prefer Telnyx over Twilio when both are connected.

router.post("/api/telnyx/activate", async (req: Request, res: Response) => {
  try {
    const ws = await getWorkspace((req as any).workspaceId);
    if (!ws) return res.status(404).json({ error: "Workspace not found" });
    if (!ws.telnyxApiKey || !ws.telnyxPhoneNumber || !ws.telnyxConnectionId) {
      return res.status(400).json({
        error: "Connect Telnyx, set a TeXML connection id, and assign a phone number first",
      });
    }
    await db
      .update(workspaces)
      .set({ voiceProvider: "telnyx", updatedAt: new Date() })
      .where(eq(workspaces.id, ws.id));
    res.json({ active: true, provider: "telnyx" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/telnyx/numbers/existing ─────────────────────────────────────────

router.get("/api/telnyx/numbers/existing", async (req: Request, res: Response) => {
  try {
    const ws = await getWorkspace((req as any).workspaceId);
    if (!ws) return res.status(404).json({ error: "Workspace not found" });
    if (!ws.telnyxApiKey) return res.status(400).json({ error: "Telnyx not connected" });

    const numbers = await listTelnyxPhoneNumbers(decrypt(ws.telnyxApiKey));
    res.json(
      numbers.map((n) => ({
        ...n,
        inUse: ws.telnyxPhoneNumber === n.phoneNumber,
        sid: n.id,
      }))
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/telnyx/numbers/use ─────────────────────────────────────────────
// Body: { phoneNumber, id, connectionId? }

router.post("/api/telnyx/numbers/use", async (req: Request, res: Response) => {
  try {
    const phoneNumber = String(req.body?.phoneNumber || "").trim();
    const phoneId = String(req.body?.id || req.body?.sid || "").trim();
    const connectionId =
      String(req.body?.connectionId || "").trim() || null;

    if (!phoneNumber || !phoneId) {
      return res.status(400).json({ error: "phoneNumber and id are required" });
    }

    const ws = await getWorkspace((req as any).workspaceId);
    if (!ws) return res.status(404).json({ error: "Workspace not found" });
    if (!ws.telnyxApiKey) return res.status(400).json({ error: "Telnyx not connected" });

    const apiKey = decrypt(ws.telnyxApiKey);
    let nextConnectionId = connectionId || ws.telnyxConnectionId;
    if (!nextConnectionId) {
      const setup = await ensureTelnyxVoiceSetup(apiKey, {
        existingMessagingProfileId: ws.telnyxMessagingProfileId,
      });
      nextConnectionId = setup.connectionId;
    }

    // Bind number to TeXML app in Telnyx so outbound + inbound voice use Leviosai.
    await assignTelnyxNumberToConnection(apiKey, phoneId, nextConnectionId);

    await db
      .update(workspaces)
      .set({
        telnyxPhoneNumber: phoneNumber,
        telnyxPhoneId: phoneId,
        telnyxConnectionId: nextConnectionId,
        voiceProvider: "telnyx",
        updatedAt: new Date(),
      })
      .where(eq(workspaces.id, ws.id));

    res.json({
      phoneNumber,
      phoneId,
      connectionId: nextConnectionId,
      ready: true,
      message: "Number linked — outbound AI calls and SMS will use Telnyx for this workspace.",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/telnyx/number/unassign ─────────────────────────────────────────

router.post("/api/telnyx/number/unassign", async (req: Request, res: Response) => {
  try {
    const ws = await getWorkspace((req as any).workspaceId);
    if (!ws) return res.status(404).json({ error: "Workspace not found" });

    await db
      .update(workspaces)
      .set({
        telnyxPhoneNumber: null,
        telnyxPhoneId: null,
        updatedAt: new Date(),
      })
      .where(eq(workspaces.id, ws.id));

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/telnyx/test-sms ────────────────────────────────────────────────

router.post("/api/telnyx/test-sms", async (req: Request, res: Response) => {
  try {
    const toRaw = String(req.body?.to || "").trim();
    if (!toRaw) return res.status(400).json({ error: "Phone number is required" });
    const to = toRaw.startsWith("+") ? toRaw.replace(/[^\d+]/g, "") : `+${toRaw.replace(/\D/g, "")}`;
    if (!/^\+[1-9]\d{7,14}$/.test(to)) {
      return res.status(400).json({
        error: "Enter a valid phone number with country code (e.g. +15551234567)",
      });
    }

    const ws = await getWorkspace((req as any).workspaceId);
    if (!ws) return res.status(404).json({ error: "Workspace not found" });

    const result = await sendOutboundSms(ws, {
      to,
      body: "Leviosai test SMS — your Telnyx connection is working. You can ignore this message.",
    });

    res.json({ ok: true, sid: result.sid, from: result.from, to, provider: result.provider });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to send test SMS" });
  }
});

export default router;
