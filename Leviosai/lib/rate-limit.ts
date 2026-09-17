import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redis, isRedisReady } from "./redis.js";

function makeStore(prefix: string) {
  if (!redis || !isRedisReady()) return undefined;
  try {
    return new RedisStore({
      sendCommand: (...args: string[]) => redis!.call(...args) as any,
      prefix: `rl:${prefix}:`,
    });
  } catch {
    return undefined; // fall back to in-memory store
  }
}

function pathOf(req: { originalUrl?: string; url?: string }): string {
  return String(req.originalUrl || req.url || "").split("?")[0];
}

/** Auth has its own limiter — don't double-count login against the general API bucket. */
function skipAuthPaths(req: { originalUrl?: string; url?: string }): boolean {
  const p = pathOf(req);
  return p.startsWith("/api/auth/login") || p.startsWith("/api/auth/register");
}

/** Twilio / Stripe / health must never be rate-limited (shared IP via ngrok). */
function skipInfrastructurePaths(req: { originalUrl?: string; url?: string }): boolean {
  const p = pathOf(req);
  return (
    p.startsWith("/api/health") ||
    p.startsWith("/api/webhooks") ||
    p.startsWith("/api/billing/webhook") ||
    p.startsWith("/api/call/connect") ||
    p.startsWith("/api/call/status") ||
    p.startsWith("/api/call/recording") ||
    p.startsWith("/api/call/stream")
  );
}

// Strict limiter for auth endpoints (login, register)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: "Too many authentication attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("auth"),
});

// General API limiter — raised for Live Calls / dashboard polling behind a shared ngrok IP.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  message: { error: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("api"),
  skip: (req) => skipAuthPaths(req) || skipInfrastructurePaths(req),
});

// AI endpoints
export const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: "Too many AI requests. Please try again shortly." },
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("ai"),
});

// Messaging endpoints
export const messagingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: "Too many messages sent. Please try again shortly." },
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("messaging"),
});

// Admin panel — plan §12.6: 50 req / 15 min per admin user
export const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: "Too many admin requests. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("admin"),
  keyGenerator: (req) => {
    const userId = (req as any).userId;
    return userId != null ? `admin:${userId}` : (req.ip || "admin:unknown");
  },
  validate: { keyGeneratorIpFallback: false },
});
