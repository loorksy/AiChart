/**
 * The platform chart session: cache → single-flight → shared headless tab.
 *
 * What scales here is the CACHE, not tab count. Gold is one shared store, so
 * every request for the same symbol/interval inside the same short moment is
 * the same picture — one capture serves them all. The tab exists in its own
 * Docker container (chart-host/) purely to HOST the internal /chart-host
 * page; the pixels still come from TradingView's takeClientScreenshot inside
 * that page, exactly like an operator tab. Playwright never screenshots.
 *
 * Honesty rules carried over verbatim from the live-capture contract:
 *  - a snapshot older than the cache window is REJECTED on read, never
 *    served — the short cache is deduplication of one moment, not a stale
 *    substitute;
 *  - a request that ships drawings is layout-specific and BYPASSES the cache
 *    entirely, both read and write;
 *  - every failure is named (host_unreachable, host_not_ready,
 *    capture_timeout, …) and the analysis proceeds on numbers, saying so.
 */
import { createLogger } from "@/lib/logger";
import { getPlatformValue } from "@/lib/platformConfig";
import { getPublicAppUrl } from "@/lib/appUrl";
import {
  captureChartImage,
  hasFreshPlatformTab,
  requestPlatformCapture,
  type CaptureFailure,
  type ChartCaptureResult,
  type PlatformCaptureDrawing,
  type RequestLiveCaptureInput,
} from "./liveCapture";
import { isChartHostSigningConfigured, mintChartHostToken } from "./hostToken";

const log = createLogger("chart.platformCapture");

/** Default snapshot cache window — one "moment" on a fast market. */
export const PLATFORM_SNAPSHOT_TTL_MS = 15_000;
const MAX_TTL_MS = 60_000;
/** Bounded: a handful of interval keys, each a few hundred KB of base64. */
const MAX_CACHE_ENTRIES = 24;

/** TTL in ms — `CHART_SNAPSHOT_CACHE_TTL_MS` overrides, 0 disables. */
export function platformSnapshotTtlMs(): number {
  const raw = Number(process.env.CHART_SNAPSHOT_CACHE_TTL_MS);
  if (!Number.isFinite(raw) || raw < 0) return PLATFORM_SNAPSHOT_TTL_MS;
  return Math.min(raw, MAX_TTL_MS);
}

export interface PlatformSnapshotEntry {
  result: ChartCaptureResult;
  capturedAt: number;
}

const cache = new Map<string, PlatformSnapshotEntry>();
/** Concurrent identical requests coalesce onto ONE in-flight capture. */
const inFlight = new Map<string, Promise<ChartCaptureResult | CaptureFailure>>();

export function platformSnapshotKey(input: {
  symbol: string;
  interval: string;
  includeStudies: boolean;
}): string {
  return `${input.symbol.toUpperCase()}:${input.interval}:${input.includeStudies ? "s1" : "s0"}`;
}

function pruneCache(now: number, ttl: number): void {
  for (const [key, entry] of cache) {
    if (now - entry.capturedAt > ttl) cache.delete(key);
  }
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/**
 * A cached snapshot is valid ONLY inside the TTL window, checked against its
 * own capturedAt at READ time — expiry bookkeeping alone is not trusted with
 * the staleness rule.
 */
export function getFreshPlatformSnapshot(
  key: string,
  now = Date.now(),
): PlatformSnapshotEntry | null {
  const ttl = platformSnapshotTtlMs();
  if (ttl <= 0) return null;
  const entry = cache.get(key);
  if (!entry) return null;
  if (now - entry.capturedAt > ttl) {
    cache.delete(key);
    return null;
  }
  return entry;
}

export function clearPlatformSnapshotCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}

export function platformSnapshotCacheSize(): number {
  return cache.size;
}

/**
 * The requesting layout's stored overlays, parsed for shipping to the
 * platform tab. Lenient by design — a malformed state means a clean chart,
 * never a failed capture; drawingsRendered is measured off the widget anyway.
 */
export function layoutOverlaysFromState(raw: string | null | undefined): {
  drawings: PlatformCaptureDrawing[];
  studies: PlatformCaptureDrawing[];
} {
  if (!raw) return { drawings: [], studies: [] };
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== "object") return { drawings: [], studies: [] };
    return {
      drawings: Array.isArray(value.drawings)
        ? (value.drawings.filter(
            (item) => item && typeof item === "object",
          ) as PlatformCaptureDrawing[])
        : [],
      studies: Array.isArray(value.studies)
        ? (value.studies.filter(
            (item) => item && typeof item === "object",
          ) as PlatformCaptureDrawing[])
        : [],
    };
  } catch {
    return { drawings: [], studies: [] };
  }
}

// ---------------------------------------------------------------------------
// Chart-host container client
// ---------------------------------------------------------------------------

/**
 * Where the chart-host container answers.
 *
 * Resolved the way EVERY other platform setting is — the operator's saved
 * value first, the process environment second. It used to read `process.env`
 * and nothing else, which made the shared chart session the one piece of
 * infrastructure an operator could not configure from the admin panel: if the
 * variable was missing from a process's environment, `chartHostConfigured()`
 * quietly returned false, the platform fallback was skipped, and every
 * unattended analysis reported "no chart could be captured" as though no chart
 * existed — while the container was running and answering the MCP bridge,
 * which loads the same file explicitly at launch.
 */
export function chartHostBaseUrl(): string | null {
  const raw = getPlatformValue("CHART_HOST_URL")?.trim();
  if (!raw) return null;
  return /^https?:\/\//.test(raw) ? raw.replace(/\/$/, "") : null;
}

export function chartHostConfigured(): boolean {
  return Boolean(chartHostBaseUrl()) && isChartHostSigningConfigured();
}

/**
 * Why the shared chart session is unavailable, for the OPERATOR.
 *
 * "No chart could be captured" is true of an unconfigured host, an unreachable
 * one, and a genuinely chartless moment alike — three different problems with
 * three different fixes, and one sentence covering all of them told the
 * operator nothing. Null means the host is configured and the reason lies
 * further down.
 */
export function chartHostUnavailableReason(): "not_configured" | "not_signed" | null {
  if (!chartHostBaseUrl()) return "not_configured";
  if (!isChartHostSigningConfigured()) return "not_signed";
  return null;
}

function chartHostControlToken(): string | null {
  const explicit = process.env.CHART_HOST_CONTROL_TOKEN?.trim();
  if (explicit && explicit.length >= 16) return explicit;
  const service = process.env.AICHART_SERVICE_TOKEN?.trim();
  if (service && service.length >= 16) return service;
  const app = process.env.APP_SECRET?.trim();
  if (app && app.length >= 16) return app;
  return null;
}

function ensureTimeoutMs(): number {
  const raw = Number(process.env.CHART_HOST_ENSURE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 1_000 ? Math.min(raw, 30_000) : 8_000;
}

/** How long a cold start may take before the FIRST capture is attempted. */
function warmupMs(): number {
  const raw = Number(process.env.CHART_HOST_WARMUP_MS);
  return Number.isFinite(raw) && raw >= 2_000 ? Math.min(raw, 60_000) : 25_000;
}

export interface ChartHostDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  isTabFresh?: () => boolean;
}

/**
 * Ask the chart-host container to have the tab open, then wait until the tab
 * actually polls. Returns a named failure instead of hanging: the container
 * unreachable and the tab never warming up are different facts and are
 * reported as such.
 */
export async function ensureChartHostTab(
  deps: ChartHostDeps = {},
): Promise<{ ok: true } | { ok: false; reason: "host_unreachable" | "host_not_ready" }> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const isTabFresh = deps.isTabFresh ?? hasFreshPlatformTab;
  const fetchImpl = deps.fetchImpl ?? fetch;

  if (isTabFresh()) return { ok: true };

  const baseUrl = chartHostBaseUrl();
  const controlToken = chartHostControlToken();
  if (!baseUrl || !controlToken || !isChartHostSigningConfigured()) {
    return { ok: false, reason: "host_unreachable" };
  }

  const pageUrl = `${getPublicAppUrl()}/chart-host?token=${encodeURIComponent(mintChartHostToken())}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ensureTimeoutMs());
    const res = await fetchImpl(`${baseUrl}/session/ensure`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${controlToken}`,
      },
      body: JSON.stringify({ pageUrl }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      log.warn("chart-host ensure rejected", { status: res.status });
      return { ok: false, reason: "host_unreachable" };
    }
  } catch (error) {
    log.warn("chart-host ensure failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "host_unreachable" };
  }

  // The page is open; the widget needs a moment before its first poll.
  const deadline = now() + warmupMs();
  while (now() < deadline) {
    if (isTabFresh()) return { ok: true };
    await sleep(500);
  }
  return { ok: false, reason: "host_not_ready" };
}

// ---------------------------------------------------------------------------
// The capture entry point for every server-side caller
// ---------------------------------------------------------------------------

export interface PlatformSnapshotInput {
  forUserId: number;
  symbol: string;
  interval: string;
  includeDrawings?: boolean;
  includeStudies?: boolean;
  /** Layout-specific overlays to render; their presence bypasses the cache. */
  drawings?: PlatformCaptureDrawing[];
  studies?: PlatformCaptureDrawing[];
  /**
   * The caller demanded a fresh render (`fresh=true` on the MCP surface):
   * the stored moment-cache is not read — though an in-flight capture, being
   * this instant's, may still serve — and the new shot is cached for others.
   */
  bypassCache?: boolean;
  ackTimeoutMs?: number;
  uploadTimeoutMs?: number;
}

export interface PlatformSnapshotOutcome {
  result: ChartCaptureResult | CaptureFailure;
  /** True when served from the shared moment-cache (still inside the TTL). */
  fromCache: boolean;
  capturedAt: number | null;
}

/**
 * One snapshot from the platform chart session. Concurrent identical
 * requests share one in-flight capture; requests inside the TTL share one
 * stored capture; anything older is re-captured, never served.
 */
export async function capturePlatformSnapshot(
  input: PlatformSnapshotInput,
  deps: ChartHostDeps & {
    ensure?: typeof ensureChartHostTab;
    request?: typeof requestPlatformCapture;
  } = {},
): Promise<PlatformSnapshotOutcome> {
  const now = deps.now ?? Date.now;
  const hasOverlays = Boolean(input.drawings?.length || input.studies?.length);
  const key = platformSnapshotKey({
    symbol: input.symbol,
    interval: input.interval,
    includeStudies: input.includeStudies !== false,
  });

  if (!hasOverlays && !input.bypassCache) {
    const cached = getFreshPlatformSnapshot(key, now());
    if (cached) {
      return { result: cached.result, fromCache: true, capturedAt: cached.capturedAt };
    }
  }

  const flightKey = hasOverlays ? null : key;
  if (flightKey) {
    const existing = inFlight.get(flightKey);
    if (existing) {
      const result = await existing;
      const entry = result.ok ? cache.get(key) : null;
      return {
        result,
        fromCache: result.ok,
        capturedAt: entry?.capturedAt ?? (result.ok ? now() : null),
      };
    }
  }

  const run = (async (): Promise<ChartCaptureResult | CaptureFailure> => {
    const ensured = await (deps.ensure ?? ensureChartHostTab)(deps);
    if (!ensured.ok) return { ok: false, reason: ensured.reason };
    const captured = await (deps.request ?? requestPlatformCapture)({
      forUserId: input.forUserId,
      symbol: input.symbol,
      interval: input.interval,
      includeDrawings: input.includeDrawings,
      includeStudies: input.includeStudies,
      drawings: input.drawings,
      studies: input.studies,
      ackTimeoutMs: input.ackTimeoutMs,
      uploadTimeoutMs: input.uploadTimeoutMs,
    });
    if (captured.ok && !hasOverlays) {
      cache.set(key, { result: captured, capturedAt: now() });
      pruneCache(now(), platformSnapshotTtlMs());
    }
    return captured;
  })();

  if (flightKey) inFlight.set(flightKey, run);
  try {
    const result = await run;
    return { result, fromCache: false, capturedAt: result.ok ? now() : null };
  } finally {
    if (flightKey) inFlight.delete(flightKey);
  }
}

/**
 * The single capture entry for server-side callers (bridge snapshot route,
 * multi-timeframe evidence): the operator's own live tab first — their
 * drawings, their layout — then the platform chart session, then the same
 * honest named failure as always. Never a stored substitute: the platform
 * path's cache serves only captures younger than the moment-window.
 */
export async function captureChartWithPlatformFallback(
  input: RequestLiveCaptureInput & {
    /** Overlays for the platform tab when the user's own tab is absent. */
    platformDrawings?: PlatformCaptureDrawing[];
    platformStudies?: PlatformCaptureDrawing[];
    /** `fresh=true` from the caller: skip the moment-cache read. */
    bypassCache?: boolean;
  },
  deps: Parameters<typeof capturePlatformSnapshot>[1] & {
    direct?: typeof captureChartImage;
    configured?: () => boolean;
  } = {},
): Promise<(ChartCaptureResult & { fromCache?: boolean }) | CaptureFailure> {
  const direct = await (deps.direct ?? captureChartImage)(input);
  if (direct.ok) return direct;
  // Only absence-of-eyes reasons fall through to the shared tab. A capture
  // that FAILED on a live tab (timeout, bad upload) stays a failure — retrying
  // it elsewhere would mask a real defect.
  if (direct.reason !== "no_live_session" && direct.reason !== "layout_not_found") {
    return direct;
  }
  if (!(deps.configured ?? chartHostConfigured)()) return direct;
  const outcome = await capturePlatformSnapshot(
    {
      forUserId: input.userId,
      symbol: input.symbol,
      interval: input.interval,
      includeDrawings: input.includeDrawings,
      includeStudies: input.includeStudies,
      drawings: input.platformDrawings,
      studies: input.platformStudies,
      bypassCache: input.bypassCache,
      ackTimeoutMs: input.ackTimeoutMs,
      uploadTimeoutMs: input.uploadTimeoutMs,
    },
    deps,
  );
  if (outcome.result.ok) {
    return { ...outcome.result, fromCache: outcome.fromCache };
  }
  return outcome.result;
}
