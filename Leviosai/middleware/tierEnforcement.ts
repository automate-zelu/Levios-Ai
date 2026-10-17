// ─── TIER ENFORCEMENT MIDDLEWARE ─────────────────────────────────────────────
// Commercial pricing has no lead/minute caps. Blocks inactive / unpaid outbound.

import { Request, Response, NextFunction } from "express";
import { db } from "../lib/db.js";
import { workspaces } from "../lib/schema.js";
import { eq } from "drizzle-orm";
import { getOutboundGateState, outboundGateHttp } from "../lib/outbound-gate.js";

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

  const gate = await getOutboundGateState(workspace.organizationId);
  if (!gate.allowed) {
    const { status, body } = outboundGateHttp(gate);
    return res.status(status).json(body);
  }

  next();
}
