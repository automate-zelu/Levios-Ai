// ─── TEAM / SEAT ROUTES ──────────────────────────────────────────────────────
// Seat enforcement (plan §5 Seat Enforcement):
// POST /api/workspace/invite returns 403 when currentSeats >= seatLimit.

import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { requireAuth } from "./auth.js";
import { db } from "../lib/db.js";
import { users, workspaces } from "../lib/schema.js";
import { eq, count } from "drizzle-orm";
import { canInviteSeat, getTierLimits } from "../lib/tiers.js";

const router = Router();

async function getOrgWorkspace(organizationId: number) {
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.organizationId, organizationId))
    .limit(1);
  return ws ?? null;
}

async function countOrgSeats(organizationId: number): Promise<number> {
  const [{ total }] = await db
    .select({ total: count() })
    .from(users)
    .where(eq(users.organizationId, organizationId));
  return Number(total);
}

// ─── GET /api/workspace/seats ─────────────────────────────────────────────────

router.get("/api/workspace/seats", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.organizationId) return res.status(400).json({ error: "No organization" });

    const workspace = await getOrgWorkspace(req.organizationId);
    if (!workspace) return res.status(404).json({ error: "Workspace not found" });

    const currentSeats = await countOrgSeats(req.organizationId);
    const tier = getTierLimits(workspace.tier);

    res.json({
      currentSeats,
      seatLimit: workspace.seatLimit,
      remaining: Math.max(0, workspace.seatLimit - currentSeats),
      tier: workspace.tier,
      tierLabel: tier.label,
      canInvite: canInviteSeat(currentSeats, workspace.seatLimit).allowed,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/workspace/invite ───────────────────────────────────────────────
// body: { email, firstName, lastName, password?, role? }
// Creates a user in the caller's organization if seats remain.

router.post("/api/workspace/invite", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.organizationId) return res.status(400).json({ error: "No organization" });

    const { email, firstName, lastName, password, role } = req.body || {};
    if (!email || !firstName || !lastName) {
      return res.status(400).json({ error: "email, firstName, and lastName are required" });
    }

    const workspace = await getOrgWorkspace(req.organizationId);
    if (!workspace) return res.status(404).json({ error: "Workspace not found" });

    const currentSeats = await countOrgSeats(req.organizationId);
    const seatCheck = canInviteSeat(currentSeats, workspace.seatLimit);
    if (!seatCheck.allowed) {
      return res.status(403).json({
        error: seatCheck.reason,
        currentSeats,
        seatLimit: workspace.seatLimit,
        upgrade: "/billing",
      });
    }

    const [existing] = await db.select().from(users).where(eq(users.email, email));
    if (existing) {
      return res.status(409).json({ error: "A user with that email already exists" });
    }

    const tempPassword = password || `Invite-${Math.random().toString(36).slice(2, 10)}!`;
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    const safeRole = role === "admin" ? "admin" : "user";

    const [created] = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        firstName,
        lastName,
        role: safeRole,
        organizationId: req.organizationId,
      })
      .returning({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        organizationId: users.organizationId,
      });

    res.status(201).json({
      user: created,
      seats: {
        currentSeats: currentSeats + 1,
        seatLimit: workspace.seatLimit,
      },
      // Only return temp password when we generated one (caller should share securely)
      temporaryPassword: password ? undefined : tempPassword,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/workspace/members ───────────────────────────────────────────────

router.get("/api/workspace/members", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.organizationId) return res.status(400).json({ error: "No organization" });

    const members = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.organizationId, req.organizationId));

    const workspace = await getOrgWorkspace(req.organizationId);

    res.json({
      members,
      seats: {
        currentSeats: members.length,
        seatLimit: workspace?.seatLimit ?? 0,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
