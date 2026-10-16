import { Router, Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { db } from "../lib/db.js";
import { users, organizations } from "../lib/schema.js";
import { eq, sql } from "drizzle-orm";
import { ensureOrgSdr } from "../lib/org-tenant.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "catalyst-dev-secret-change-in-production";

function normalizeEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

async function findUserByEmail(email: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  return user ?? null;
}

async function issueSession(user: typeof users.$inferSelect) {
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
  return {
    token,
    user: publicUser(user, { workspaceId, tier: workspaceTier }),
  };
}

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

// Register — auto-creates an organization for the user.
// If the email already exists with incomplete Levvi setup and the password matches,
// resume the session instead of returning "already registered".
router.post("/api/auth/register", async (req: Request, res: Response) => {
  try {
    const { password, firstName, lastName, organizationName } = req.body;
    const email = normalizeEmail(req.body?.email);
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: "All fields required" });
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      const incomplete = existing.onboardingComplete === false;
      if (incomplete) {
        const valid = await bcrypt.compare(password, existing.passwordHash);
        if (valid) {
          const session = await issueSession(existing);
          return res.status(200).json({
            ...session,
            resumed: true,
            message: "Welcome back — continue Levvi setup where you left off.",
          });
        }
        return res.status(409).json({
          error:
            "Account exists with incomplete setup. Please log in with your password to continue Levvi setup.",
          code: "ONBOARDING_INCOMPLETE",
          resumeViaLogin: true,
        });
      }
      return res.status(409).json({
        error: "Email already registered. Please log in.",
        code: "EMAIL_TAKEN",
      });
    }

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

    const session = await issueSession(user);
    res.status(201).json({
      ...session,
      resumed: false,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Login — incomplete onboarding users land back in Levvi via onboardingComplete: false
router.post("/api/auth/login", async (req: Request, res: Response) => {
  try {
    const password = req.body?.password;
    const email = normalizeEmail(req.body?.email);
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const user = await findUserByEmail(email);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    const session = await issueSession(user);
    res.json({
      ...session,
      resumeOnboarding: user.onboardingComplete === false,
    });
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

    // P5 — notify external onboarding app
    if (user.organizationId) {
      void import("../lib/onboarding-webhooks.js").then(({ emitOnboardingAppWebhook }) =>
        emitOnboardingAppWebhook({
          type: "onboarding.completed",
          organizationId: user.organizationId!,
          workspaceId: req.workspaceId ?? null,
          userId: user.id,
          email: user.email,
        })
      );
    }

    res.json({ id: user.id, onboardingComplete: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
