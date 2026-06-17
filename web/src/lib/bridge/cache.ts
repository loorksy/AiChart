export interface BridgeCacheEntry<T> {
  value: T;
  cachedAt: number;
  expiresAt: number;
}

export interface BridgeCacheHit<T> {
  value: T;
  cachedAt: number;
  ageMs: number;
  fromCache: true;
}

export interface BridgeCacheMiss {
  fromCache: false;
}

export type BridgeCacheResult<T> = BridgeCacheHit<T> | BridgeCacheMiss;

const store = new Map<string, BridgeCacheEntry<unknown>>();

function defaultTtlMs(): number {
  const raw = Number(process.env.BRIDGE_CACHE_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 5000;
}

export function bridgeCacheKey(userId: number, resource: string): string {
  return `${userId}:${resource}`;
}

export function getBridgeCacheTtlMs(overrideMs?: number): number {
  return overrideMs ?? defaultTtlMs();
}

/** Future hook: when REDIS_URL is set, a Redis adapter can replace the in-memory store. */
export function isRedisCacheConfigured(): boolean {
  return Boolean(process.env.REDIS_URL?.trim());
}

export function getCached<T>(
  userId: number,
  resource: string,
): BridgeCacheResult<T> {
  const key = bridgeCacheKey(userId, resource);
  const entry = store.get(key) as BridgeCacheEntry<T> | undefined;
  if (!entry) return { fromCache: false };

  const now = Date.now();
  if (now >= entry.expiresAt) {
    store.delete(key);
    return { fromCache: false };
  }

  return {
    value: entry.value,
    cachedAt: entry.cachedAt,
    ageMs: now - entry.cachedAt,
    fromCache: true,
  };
}

export function setCached<T>(
  userId: number,
  resource: string,
  value: T,
  ttlMs?: number,
): BridgeCacheEntry<T> {
  const now = Date.now();
  const ttl = getBridgeCacheTtlMs(ttlMs);
  const entry: BridgeCacheEntry<T> = {
    value,
    cachedAt: now,
    expiresAt: now + ttl,
  };
  store.set(bridgeCacheKey(userId, resource), entry as BridgeCacheEntry<unknown>);
  return entry;
}

export function invalidateCached(userId: number, resource: string): void {
  store.delete(bridgeCacheKey(userId, resource));
}

/** Test helper — clears the in-memory cache. */
export function clearBridgeCache(): void {
  store.clear();
}
