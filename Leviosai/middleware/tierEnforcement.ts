// ─── TIER ENFORCEMENT MIDDLEWARE ─────────────────────────────────────────────
// Checks workspace monthly lead limit before allowing any enrollment.
// Applied to POST /api/sdr/enroll/:leadId.
// The Reactor scan also enforces this independently — limits are checked at
// both the API layer and the scan layer (per implementation plan §15.2).

import { Request, Response, NextFunction } from "express";
import { db } from "../lib/db.js";
import { workspaces } from "../lib/schema.js";
import { eq } from "drizzle-orm";
import { isLeadLimitReached, getTierLimits } from "../lib/tiers.js";

export async function enforceTierLimits(req: Request, res: Response, next: NextFunction) {
  const workspaceId = req.workspace?.id;
  if (!workspaceId) {
    return res.status(403).json({ error: "No workspace context" });
  }

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));

  if (!workspace) {
    return res.status(404).json({ error: "Workspace not found" });
  }

  if (!workspace.isActive) {
    return res.status(403).json({
      error: "SDR features require an active subscription",
      subscribe: "/billing",
    });
  }

  if (isLeadLimitReached(workspace.monthlyLeadsUsed, workspace.monthlyLeadLimit)) {
    const tier = getTierLimits(workspace.tier);
    return res.status(429).json({
      error: "Monthly lead limit reached",
      limit: workspace.monthlyLeadLimit,
      used: workspace.monthlyLeadsUsed,
      tier: workspace.tier,
      tierLabel: tier.label,
      upgrade: "/billing",
    });
  }

  next();
}
