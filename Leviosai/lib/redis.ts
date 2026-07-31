import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL;

let redis: Redis | null = null;
let redisReady = false;

if (redisUrl) {
  try {
    redis = new Redis(redisUrl, {
      tls: redisUrl.startsWith("rediss://") ? {} : undefined,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 10) {
          console.error("⚠️  Redis: max retries reached, giving up");
          redisReady = false;
          return null; // stop retrying
        }
        return Math.min(times * 100, 3000);
      },
      lazyConnect: false,
    });

    redis.on("connect", () => {
      redisReady = true;
      console.log("✅ Redis connected");
    });
    redis.on("ready", () => { redisReady = true; });
    redis.on("error", (err) => {
      redisReady = false;
      if (err.message?.includes("max requests limit exceeded")) {
        console.error("⚠️  Upstash request limit reached — disabling Redis, falling back to in-memory");
      } else {
        console.error("⚠️  Redis error:", err.message);
      }
    });
    redis.on("close", () => { redisReady = false; });
  } catch (err: any) {
    console.error("⚠️  Redis initialization failed:", err.message);
    redis = null;
  }
} else {
  console.warn("⚠️  REDIS_URL not set — Redis features disabled");
}

export function isRedisReady(): boolean {
  return redis !== null && redisReady;
}

export { redis };
export default redis;
