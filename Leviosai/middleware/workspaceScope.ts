/**
 * Attach this request to the caller's organization SDR.
 * Tenant is always organizationId from the JWT — never a client-supplied workspace id.
 * Invited teammates share the same org, so they share the same agent and bill.
 */

import { Request, Response, NextFunction } from "express";
import { ensureOrgSdr } from "../lib/org-tenant.js";

declare global {
  namespace Express {
    interface Request {
      workspace?: {
        id: string;
        tier: string;
      };
    }
  }
}

export async function workspaceScope(req: Request, res: Response, next: NextFunction) {
  if (!req.organizationId) {
    return res.status(403).json({ error: "No organization associated with this account" });
  }

  try {
    const sdr = await ensureOrgSdr(req.organizationId);
    req.workspaceId = sdr.workspaceId;
    req.workspaceTier = sdr.tier;
    req.workspace = {
      id: sdr.workspaceId,
      tier: sdr.tier,
    };
    next();
  } catch (err: any) {
    console.error("workspaceScope:", err?.message || err);
    return res.status(403).json({ error: "No organization associated with this account" });
  }
}
