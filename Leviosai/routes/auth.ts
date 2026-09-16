import { Router, Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { db } from "../lib/db.js";
import { users, organizations } from "../lib/schema.js";
import { eq } from "drizzle-orm";
import { ensureOrgSdr } from "../lib/org-tenant.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "catalyst-dev-secret-change-in-production";

// Extend Express Request with auth fields
declare global {
  namespace Express {
    interface Request {
      userId?: number;
      userEmail?: string;
      userRole?: string;
      organizationId?: number | null;
      // SDR is attached via organizationId; workspaceScope loads it from the org.
      workspaceId?: string;
      workspaceTier?: string;
    }
  }
}

// Auth middleware — sets userId, userEmail, organizationId, workspaceId, workspaceTier on request
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Authentication required" });
    const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET) as any;
    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    req.userRole = decoded.role ?? undefined;
    req.organizationId = decoded.organizationId;
    req.workspaceId = decoded.workspaceId ?? undefined;
    req.workspaceTier = decoded.tier ?? "starter";
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

function publicUser(user: typeof users.$inferSelect, extras: Record<string, unknown> = {}) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    organizationId: user.organizationId,
    onboardingComplete: user.onboardingComplete ?? true,
    ...extras,
  };
}

// Register — auto-creates an organization for the user
router.post("/api/auth/register", async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName, organizationName } = req.body;
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: "All fields required" });
    }
    const [existing] = await db.select().from(users).where(eq(users.email, email));
    if (existing) return res.status(409).json({ error: "Email already registered" });

    // Create organization for this user
    const orgName = organizationName || `${firstName}'s Organization`;
    const [org] = await db.insert(organizations).values({ name: orgName }).returning();

    const passwordHash = await bcrypt.hash(password, 12);
    const [user] = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        firstName,
        lastName,
        organizationId: org.id,
        onboardingComplete: false,
      })
      .returning();

    const sdr = await ensureOrgSdr(org.id);

    void import("../lib/product-email.js")
      .then(({ sendProductEmail }) =>
        import("../lib/email-templates.js").then(({ welcomeEmail }) =>
          sendProductEmail(
            user.email,
            welcomeEmail({ firstName: user.firstName, organizationName: org.name })
          )
        )
      )
      .catch((err: Error) => console.error("Welcome email failed:", err.message));

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        organizationId: org.id,
        workspaceId: sdr.workspaceId,
        tier: sdr.tier,
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      token,
      user: publicUser(user, {
        organizationId: org.id,
        workspaceId: sdr.workspaceId,
        tier: sdr.tier,
        onboardingComplete: false,
      }),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Login
router.post("/api/auth/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    let workspaceId: string | null = null;
    let workspaceTier = "starter";
    if (user.organizationId) {
      const sdr = await ensureOrgSdr(user.organizationId);
      workspaceId = sdr.workspaceId;
      workspaceTier = sdr.tier;
    }

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
        workspaceId,
        tier: workspaceTier,
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    const responsePayload = {
      token,
      user: publicUser(user, { workspaceId, tier: workspaceTier }),
    };

    console.log("🔑 Login response:", JSON.stringify(responsePayload, null, 2));

    res.json(responsePayload);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get current user
router.get("/api/auth/me", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "No token" });
    const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET) as any;
    const [user] = await db.select().from(users).where(eq(users.id, decoded.userId));
    if (!user) return res.status(401).json({ error: "User not found" });
    let extras: Record<string, unknown> = {};
    if (user.organizationId) {
      const sdr = await ensureOrgSdr(user.organizationId);
      extras = { workspaceId: sdr.workspaceId, tier: sdr.tier, organizationId: user.organizationId };
    }
    res.json(publicUser(user, extras));
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

// Mark SDR onboarding wizard as complete (plan §13.4)
router.post("/api/auth/onboarding/complete", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Authentication required" });
    const [user] = await db
      .update(users)
      .set({ onboardingComplete: true })
      .where(eq(users.id, userId))
      .returning();
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ id: user.id, onboardingComplete: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
