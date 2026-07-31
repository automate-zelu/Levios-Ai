// Org-scoped settings — feature toggles & user preferences stored as JSON.
// GET /api/settings → { settings: {...} }
// PUT /api/settings  body: { settings: {...} } → upserts full blob
// PATCH /api/settings body: { key: value, ... } → merges into existing blob

import { Router, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "../lib/db.js";
import { requireAuth } from "./auth.js";

const router = Router();

// Default settings shipped with every org. Frontend should fall back to these
// if the key isn't present in the DB blob.
const DEFAULTS: Record<string, boolean> = {
  // Lead notifications
  "notify.lead.created": true,
  "notify.lead.scoreChanged": true,
  "notify.lead.replied": true,
  "notify.lead.decayWarning": false,
  // Appointment notifications
  "notify.appt.booked": true,
  "notify.appt.confirmed": true,
  "notify.appt.noShow": true,
  "notify.appt.reminder24h": true,
  // Campaign notifications
  "notify.campaign.completed": true,
  "notify.campaign.dailyDigest": false,
  "notify.campaign.weeklySummary": true,
  // Delivery
  "notify.channel.inApp": true,
  "notify.channel.email": true,
  "notify.channel.sms": false,
  // AI learning
  "ai.learning.continuous": true,
  "ai.learning.autoImprove": true,
  "ai.learning.industryPsychology": true,
  "ai.learning.autoUpsell": true,
  // Lead scoring
  "ai.scoring.autoDecay": true,
  "ai.scoring.marketBoost": true,
  "ai.scoring.autoScore": true,
  // Outreach
  "ai.outreach.autoFollowUp": true,
  "ai.outreach.quietHours": true,
  "ai.outreach.tcpa": true,
  "ai.outreach.dncCheck": true,
  // Security
  "security.encryptAtRest": true,
  "security.auditLogging": true,
  "security.piiRedact": true,
  // Voice AI
  "voice.lowLatency": true,
  "voice.gracefulInterrupts": true,
  "voice.detectFirmNo": true,
  "voice.aiDisclosure": true,
  // Compliance (Voice AI tab)
  "compliance.pewc": true,
  "compliance.oneToOne": true,
  "compliance.aiDisclosure": true,
  "compliance.dncScrubbing": true,
  "compliance.quietHours": true,
  "compliance.instantOptOut": true,
  "compliance.intentDetection": true,
  "compliance.a2p10dlc": true,
  "compliance.auditTrail": true,
  // Appointments page
  "appt.autoConfirm": true,
  "appt.reminder24h": true,
  "appt.sameDayReminder": true,
  "appt.showUpTracking": true,
  // Proposals — financing options
  "proposal.financing.cash": true,
  "proposal.financing.loan": true,
  "proposal.financing.lease": true,
  "proposal.financing.ppa": true,
};

async function ensureTable() {
  // Idempotent — create table + unique constraint if missing
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS org_settings (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL UNIQUE REFERENCES organizations(id),
      settings TEXT NOT NULL DEFAULT '{}',
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function readSettings(orgId: number): Promise<Record<string, any>> {
  await ensureTable();
  const result: any = await db.execute(sql`
    SELECT settings FROM org_settings WHERE organization_id = ${orgId} LIMIT 1
  `);
  const row = result.rows?.[0] || result[0];
  if (!row) return { ...DEFAULTS };
  try {
    const stored = JSON.parse(row.settings || "{}");
    return { ...DEFAULTS, ...stored };
  } catch {
    return { ...DEFAULTS };
  }
}

async function writeSettings(orgId: number, settings: Record<string, any>) {
  await ensureTable();
  const json = JSON.stringify(settings);
  await db.execute(sql`
    INSERT INTO org_settings (organization_id, settings, updated_at)
    VALUES (${orgId}, ${json}, CURRENT_TIMESTAMP)
    ON CONFLICT (organization_id)
    DO UPDATE SET settings = ${json}, updated_at = CURRENT_TIMESTAMP
  `);
}

// GET /api/settings — return the merged (defaults + stored) settings blob
router.get("/api/settings", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = req.organizationId;
    if (!orgId) return res.status(400).json({ error: "No organization" });
    const settings = await readSettings(orgId);
    res.json({ settings, defaults: DEFAULTS });
  } catch (err: any) {
    console.error("GET /api/settings error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings — replace the full blob
router.put("/api/settings", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = req.organizationId;
    if (!orgId) return res.status(400).json({ error: "No organization" });
    const { settings } = req.body || {};
    if (typeof settings !== "object" || settings === null) {
      return res.status(400).json({ error: "settings must be an object" });
    }
    await writeSettings(orgId, settings);
    res.json({ ok: true, settings });
  } catch (err: any) {
    console.error("PUT /api/settings error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/settings — merge partial update into existing blob
router.patch("/api/settings", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = req.organizationId;
    if (!orgId) return res.status(400).json({ error: "No organization" });
    const patch = req.body || {};
    if (typeof patch !== "object" || Array.isArray(patch)) {
      return res.status(400).json({ error: "body must be a key/value object" });
    }
    const current = await readSettings(orgId);
    const merged = { ...current, ...patch };
    await writeSettings(orgId, merged);
    res.json({ ok: true, settings: merged });
  } catch (err: any) {
    console.error("PATCH /api/settings error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
