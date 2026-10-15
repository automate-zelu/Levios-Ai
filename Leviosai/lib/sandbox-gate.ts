/**
 * Server-side sandbox gate (P2.5).
 * Normal customers get 403. Admins and ENABLE_SANDBOX=1 may access.
 */

import type { Request, Response, NextFunction } from "express";
import { requireAuth } from "../routes/auth.js";

export function isSandboxEnabledForRequest(req: Request): boolean {
  if (process.env.ENABLE_SANDBOX === "1" || process.env.ENABLE_SANDBOX === "true") {
    return true;
  }
  if (req.userRole === "admin") return true;
  return false;
}

/** Auth required + role/env gate. */
export function requireSandboxAccess(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (!isSandboxEnabledForRequest(req)) {
      return res.status(403).json({
        error: "Sandbox is not available for this account",
        code: "sandbox_forbidden",
      });
    }
    next();
  });
}
