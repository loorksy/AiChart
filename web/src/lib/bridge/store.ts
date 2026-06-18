/**
 * Shared KV backend for bridge cache + rate limiting (multi-instance safe via Redis).
 */

export interface WindowCheckResult {
  allowed: boolean;
  retryAfterMs: number;
}

export interface BridgeKvStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  del(key: string): Promise<void>;
  checkSlidingWindow(
    key: string,
    windowMs: number,
    limit: number,
    now?: number,
  ): Promise<WindowCheckResult>;
}

class MemoryKvStore implements BridgeKvStore {
  private strings = new Map<string, { value: string; expiresAt: number }>();
  private windows = new Map<string, number[]>();

  async get(key: string): Promise<string | null> {
    const entry = this.strings.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.strings.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    this.strings.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  async del(key: string): Promise<void> {
    this.strings.delete(key);
    this.windows.delete(key);
  }

  async checkSlidingWindow(
    key: string,
    windowMs: number,
    limit: number,
    now = Date.now(),
  ): Promise<WindowCheckResult> {
    const entry = this.windows.get(key) ?? [];
    const cutoff = now - windowMs;
    const timestamps = entry.filter((t) => t > cutoff);

    if (timestamps.length >= limit) {
      const oldest = timestamps[0] ?? now;
      this.windows.set(key, timestamps);
      return {
        allowed: false,
        retryAfterMs: Math.max(0, oldest + windowMs - now),
      };
    }

    timestamps.push(now);
    this.windows.set(key, timestamps);
    return { allowed: true, retryAfterMs: 0 };
  }
}

let redisClient: import("ioredis").default | null = null;
let redisFailed = false;

async function getRedisClient(): Promise<import("ioredis").default | null> {
  const url = process.env.REDIS_URL?.trim();
  if (!url || redisFailed) return null;

  if (redisClient) return redisClient;

  try {
    const Redis = (await import("ioredis")).default;
    redisClient = new Redis(url, {
      maxRetriesPerRequest: 2,
      connectTimeout: 5000,
      enableOfflineQueue: false,
    });
    return redisClient;
  } catch (err) {
    redisFailed = true;
    console.warn("[bridge] Redis unavailable, falling back to memory:", err);
    return null;
  }
}

class RedisKvStore implements BridgeKvStore {
  private memoryFallback = new MemoryKvStore();

  private async clientOrFallback(): Promise<import("ioredis").default | null> {
    return getRedisClient();
  }

  async get(key: string): Promise<string | null> {
    const client = await this.clientOrFallback();
    if (!client) return this.memoryFallback.get(key);
    try {
      return await client.get(key);
    } catch {
      return this.memoryFallback.get(key);
    }
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    const client = await this.clientOrFallback();
    if (!client) {
      await this.memoryFallback.set(key, value, ttlMs);
      return;
    }
    try {
      const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
      await client.set(key, value, "EX", ttlSec);
    } catch {
      await this.memoryFallback.set(key, value, ttlMs);
    }
  }

  async del(key: string): Promise<void> {
    const client = await this.clientOrFallback();
    if (!client) {
      await this.memoryFallback.del(key);
      return;
    }
    try {
      await client.del(key);
    } catch {
      await this.memoryFallback.del(key);
    }
  }

  async checkSlidingWindow(
    key: string,
    windowMs: number,
    limit: number,
    now = Date.now(),
  ): Promise<WindowCheckResult> {
    const client = await this.clientOrFallback();
    if (!client) {
      return this.memoryFallback.checkSlidingWindow(key, windowMs, limit, now);
    }

    const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;
    const windowSec = Math.ceil(windowMs / 1000);

    try {
      const multi = client.multi();
      multi.zremrangebyscore(key, 0, now - windowMs);
      multi.zadd(key, now, member);
      multi.zcard(key);
      multi.expire(key, windowSec);
      const results = await multi.exec();
      const count = Number(results?.[2]?.[1] ?? 0);

      if (count > limit) {
        await client.zrem(key, member);
        const oldest = await client.zrange(key, 0, 0, "WITHSCORES");
        const oldestScore = oldest[1] ? Number(oldest[1]) : now;
        return {
          allowed: false,
          retryAfterMs: Math.max(0, oldestScore + windowMs - now),
        };
      }

      return { allowed: true, retryAfterMs: 0 };
    } catch {
      return this.memoryFallback.checkSlidingWindow(key, windowMs, limit, now);
    }
  }
}

const memoryStore = new MemoryKvStore();
let activeStore: BridgeKvStore | null = null;

export function isRedisCacheConfigured(): boolean {
  return Boolean(process.env.REDIS_URL?.trim());
}

export function getBridgeKvStore(): BridgeKvStore {
  if (activeStore) return activeStore;
  activeStore = isRedisCacheConfigured()
    ? new RedisKvStore()
    : memoryStore;
  return activeStore;
}

/** Test helper — reset singleton + memory state. */
export function resetBridgeKvStoreForTests(): void {
  activeStore = null;
  redisFailed = false;
  if (redisClient) {
    redisClient.disconnect();
    redisClient = null;
  }
}

export function bridgeRedisKey(kind: "cache" | "rl", parts: string[]): string {
  return `aichart:${kind}:${parts.join(":")}`;
}
