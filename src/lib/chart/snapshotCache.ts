/**
 * Very short-lived in-process cache for captured chart PNGs.
 *
 * A multi-timeframe analysis frequently re-captures the same symbol/timeframe
 * within the same "moment" (the agent revisits 1h after looking at 4h, a retry
 * follows a partial failure). Re-rendering costs a QuickChart POST for an
 * image that cannot have meaningfully changed yet, so a ~12s TTL removes the
 * duplicate work without ever serving a stale bar.
 *
 * Deliberately in-process rather than the shared bridge KV: entries are
 * hundreds of kilobytes of base64 and live for seconds, which is exactly what
 * a bounded local map is for.
 */

/**
 * Where a snapshot image came from.
 * - `tradingview_capture`: takeClientScreenshot from a live chart tab.
 * - `quickchart_fallback`: server-side redraw — never the operator's chart.
 */
export type ChartSnapshotSource = "tradingview_capture" | "quickchart_fallback";

export interface CachedChartSnapshot {
  imageBase64: string;
  source: ChartSnapshotSource;
  /** Epoch ms at which the image was produced. */
  capturedAt: number;
}

interface CacheEntry extends CachedChartSnapshot {
  expiresAt: number;
}

const DEFAULT_TTL_MS = 12_000;
const MAX_TTL_MS = 60_000;
/** Bounded so a burst of symbols cannot pin large buffers in memory. */
const MAX_ENTRIES = 48;

const cache = new Map<string, CacheEntry>();

/** Snapshot cache TTL in ms — `CHART_SNAPSHOT_CACHE_TTL_MS` overrides, 0 disables. */
export function chartSnapshotCacheTtlMs(): number {
  const raw = Number(process.env.CHART_SNAPSHOT_CACHE_TTL_MS);
  if (!Number.isFinite(raw) || raw < 0) return DEFAULT_TTL_MS;
  return Math.min(raw, MAX_TTL_MS);
}

export function chartSnapshotCacheKey(
  userId: number,
  symbol: string,
  interval: string,
  market: string,
): string {
  return `${userId}:${market}:${symbol.toUpperCase()}:${interval}`;
}

function prune(now: number): void {
  for (const [key, entry] of cache) {
    if (now >= entry.expiresAt) cache.delete(key);
  }
  // Insertion order eviction — the oldest survivor goes first.
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

export function getCachedChartSnapshot(
  key: string,
  now = Date.now(),
): CachedChartSnapshot | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (now >= entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return {
    imageBase64: entry.imageBase64,
    source: entry.source,
    capturedAt: entry.capturedAt,
  };
}

export function setCachedChartSnapshot(
  key: string,
  snapshot: CachedChartSnapshot,
  now = Date.now(),
): void {
  const ttl = chartSnapshotCacheTtlMs();
  if (ttl <= 0) return;
  // Re-insert so the eviction order reflects the newest write.
  cache.delete(key);
  cache.set(key, { ...snapshot, expiresAt: now + ttl });
  prune(now);
}

export function clearChartSnapshotCache(): void {
  cache.clear();
}

/** Entry count — diagnostics and tests only. */
export function chartSnapshotCacheSize(): number {
  return cache.size;
}
