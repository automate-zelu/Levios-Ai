// ─── WORKSPACE SCOPE MIDDLEWARE ──────────────────────────────────────────────
// Injects workspace context onto every SDR route request.
// workspaceId is read exclusively from the validated JWT payload — never from
// the request body. This guarantees a tenant can never spoof another workspace.

import { Request, Response, NextFunction } from "express";

// Extend Express Request with workspace context
declare global {
  namespace Express {
    interface Request {
      workspace?: {
        id: string;   // workspace uuid
        tier: string; // starter | growth | scale | enterprise
      };
    }
  }
}

export function workspaceScope(req: Request, res: Response, next: NextFunction) {
  // req.workspaceId and req.workspaceTier are set by the JWT middleware (routes/auth.ts)
  const workspaceId = (req as any).workspaceId as string | undefined;
  const workspaceTier = (req as any).workspaceTier as string | undefined;

  if (!workspaceId) {
    return res.status(403).json({ error: "No workspace associated with this account" });
  }

  req.workspace = {
    id: workspaceId,
    tier: workspaceTier || "starter",
  };

  next();
}
