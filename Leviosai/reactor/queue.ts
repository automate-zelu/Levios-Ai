// ─── PRIORITY QUEUE ──────────────────────────────────────────────────────────
// In-memory min-heap by default. Swaps to Redis sorted-set when REDIS_URL set.

import type { ReactorEvent } from "./types.js";
import { redis, isRedisReady } from "../lib/redis.js";

const REDIS_KEY = "reactor:queue";

export interface IPriorityQueue {
  enqueue(event: ReactorEvent): Promise<void> | void;
  dequeue(): Promise<ReactorEvent | null> | ReactorEvent | null;
  peek(): Promise<ReactorEvent | null> | ReactorEvent | null;
  size(): Promise<number> | number;
  drain(): Promise<ReactorEvent[]> | ReactorEvent[];
}

// ─── Redis-backed sorted-set queue with in-memory fallback ──────────────────

export class RedisPriorityQueue implements IPriorityQueue {
  private fallback = new InMemoryPriorityQueue();
  private usingFallback = false;

  private checkRedis(): boolean {
    if (!isRedisReady()) {
      if (!this.usingFallback) {
        console.warn("⚠️  Redis unavailable — Reactor queue falling back to in-memory");
        this.usingFallback = true;
      }
      return false;
    }
    if (this.usingFallback) {
      console.log("✅ Redis reconnected — Reactor queue back on Redis");
      this.usingFallback = false;
    }
    return true;
  }

  async enqueue(event: ReactorEvent): Promise<void> {
    if (!this.checkRedis()) return this.fallback.enqueue(event);
    try {
      const score = event.metadata.priority * 1e13 + event.metadata.createdAt.getTime();
      await redis!.zadd(REDIS_KEY, score, JSON.stringify(event));
    } catch (err: any) {
      if (!this.usingFallback) {
        console.error("⚠️  Redis enqueue failed, using fallback:", err.message);
        this.usingFallback = true;
      }
      this.fallback.enqueue(event);
    }
  }

  async dequeue(): Promise<ReactorEvent | null> {
    if (!this.checkRedis()) return this.fallback.dequeue();
    try {
      const result = await redis!.zpopmin(REDIS_KEY, 1);
      if (!result || result.length < 2) return this.fallback.dequeue();
      const raw = result[0] as string;
      const parsed = JSON.parse(raw);
      parsed.metadata.createdAt = new Date(parsed.metadata.createdAt);
      return parsed as ReactorEvent;
    } catch (err: any) {
      if (!this.usingFallback) {
        console.error("⚠️  Redis dequeue failed, using fallback:", err.message);
        this.usingFallback = true;
      }
      return this.fallback.dequeue();
    }
  }

  async peek(): Promise<ReactorEvent | null> {
    if (!this.checkRedis()) return this.fallback.peek();
    try {
      const result = await redis!.zrange(REDIS_KEY, 0, 0);
      if (!result || result.length === 0) return this.fallback.peek();
      const parsed = JSON.parse(result[0]);
      parsed.metadata.createdAt = new Date(parsed.metadata.createdAt);
      return parsed as ReactorEvent;
    } catch {
      return this.fallback.peek();
    }
  }

  async size(): Promise<number> {
    if (!this.checkRedis()) return this.fallback.size();
    try {
      return await redis!.zcard(REDIS_KEY);
    } catch {
      return this.fallback.size();
    }
  }

  async drain(): Promise<ReactorEvent[]> {
    if (!this.checkRedis()) return this.fallback.drain();
    try {
      const members = await redis!.zrange(REDIS_KEY, 0, -1);
      if (members.length > 0) await redis!.del(REDIS_KEY);
      return members.map((m) => {
        const p = JSON.parse(m);
        p.metadata.createdAt = new Date(p.metadata.createdAt);
        return p as ReactorEvent;
      });
    } catch {
      return this.fallback.drain();
    }
  }
}

// ─── In-memory min-heap fallback ─────────────────────────────────────────────

export class InMemoryPriorityQueue implements IPriorityQueue {
  private heap: ReactorEvent[] = [];

  enqueue(event: ReactorEvent): void {
    this.heap.push(event);
    this._bubbleUp(this.heap.length - 1);
  }

  dequeue(): ReactorEvent | null {
    if (this.heap.length === 0) return null;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  peek(): ReactorEvent | null {
    return this.heap[0] || null;
  }

  size(): number {
    return this.heap.length;
  }

  drain(): ReactorEvent[] {
    const events: ReactorEvent[] = [];
    while (this.heap.length > 0) events.push(this.dequeue()!);
    return events;
  }

  private _compare(a: ReactorEvent, b: ReactorEvent): number {
    if (a.metadata.priority !== b.metadata.priority) return a.metadata.priority - b.metadata.priority;
    return a.metadata.createdAt.getTime() - b.metadata.createdAt.getTime();
  }

  private _bubbleUp(idx: number): void {
    while (idx > 0) {
      const parentIdx = Math.floor((idx - 1) / 2);
      if (this._compare(this.heap[idx], this.heap[parentIdx]) < 0) {
        [this.heap[idx], this.heap[parentIdx]] = [this.heap[parentIdx], this.heap[idx]];
        idx = parentIdx;
      } else break;
    }
  }

  private _sinkDown(idx: number): void {
    const length = this.heap.length;
    while (true) {
      let smallest = idx;
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;
      if (left < length && this._compare(this.heap[left], this.heap[smallest]) < 0) smallest = left;
      if (right < length && this._compare(this.heap[right], this.heap[smallest]) < 0) smallest = right;
      if (smallest !== idx) {
        [this.heap[idx], this.heap[smallest]] = [this.heap[smallest], this.heap[idx]];
        idx = smallest;
      } else break;
    }
  }
}

// Export the right implementation based on whether Redis is available
export function createQueue(): IPriorityQueue {
  if (redis) {
    console.log("⚡ Reactor queue: Redis (Upstash)");
    return new RedisPriorityQueue();
  }
  console.log("⚡ Reactor queue: in-memory");
  return new InMemoryPriorityQueue();
}
