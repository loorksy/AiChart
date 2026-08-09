import { bridgeRedisKey, getBridgeKvStore, isRedisCacheConfigured } from "./store";

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

export { isRedisCacheConfigured };

function redisCacheKey(userId: number, resource: string): string {
  return bridgeRedisKey("cache", [String(userId), resource]);
}

export async function getCachedAsync<T>(
  userId: number,
  resource: string,
): Promise<BridgeCacheResult<T>> {
  const store = getBridgeKvStore();
  const raw = await store.get(redisCacheKey(userId, resource));
  if (!raw) return { fromCache: false };

  try {
    const entry = JSON.parse(raw) as BridgeCacheEntry<T>;
    const now = Date.now();
    if (now >= entry.expiresAt) {
      await store.del(redisCacheKey(userId, resource));
      return { fromCache: false };
    }
    return {
      value: entry.value,
      cachedAt: entry.cachedAt,
      ageMs: now - entry.cachedAt,
      fromCache: true,
    };
  } catch {
    return { fromCache: false };
  }
}

export async function setCachedAsync<T>(
  userId: number,
  resource: string,
  value: T,
  ttlMs?: number,
): Promise<BridgeCacheEntry<T>> {
  const now = Date.now();
  const ttl = getBridgeCacheTtlMs(ttlMs);
  const entry: BridgeCacheEntry<T> = {
    value,
    cachedAt: now,
    expiresAt: now + ttl,
  };
  await getBridgeKvStore().set(
    redisCacheKey(userId, resource),
    JSON.stringify(entry),
    ttl,
  );
  return entry;
}

export async function invalidateCachedAsync(
  userId: number,
  resource: string,
): Promise<void> {
  await getBridgeKvStore().del(redisCacheKey(userId, resource));
}

/** Aliases for callers migrating from sync API. */
export const getCached = getCachedAsync;
export const setCached = setCachedAsync;
export const invalidateCached = invalidateCachedAsync;

export function clearBridgeCache(): void {
  // use resetBridgeKvStoreForTests in unit tests
}
