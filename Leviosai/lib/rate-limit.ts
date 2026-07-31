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

// Strict limiter for auth endpoints (login, register)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: "Too many authentication attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("auth"),
});

// General API limiter
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("api"),
});

// AI endpoints
export const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
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
