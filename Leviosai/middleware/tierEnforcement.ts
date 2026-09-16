// ─── TIER ENFORCEMENT MIDDLEWARE ─────────────────────────────────────────────
// Commercial pricing has no lead/minute caps. This only blocks inactive accounts.

import { Request, Response, NextFunction } from "express";
import { db } from "../lib/db.js";
import { workspaces } from "../lib/schema.js";
import { eq } from "drizzle-orm";

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

  next();
}
