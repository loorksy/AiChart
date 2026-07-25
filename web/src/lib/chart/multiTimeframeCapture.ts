/**
 * Multi-timeframe visual evidence: several chart PNGs for one symbol captured
 * in parallel, each paired with the numeric context for the SAME timeframe.
 *
 * Why the pairing lives here rather than in the model: an image is context for
 * shape (rejection wick, gap, formation), never a source of precise numbers.
 * Every figure returned next to an image comes from the deterministic numeric
 * engines (`buildForexSnapshot`, `detectStructureLevels`,
 * `detectNumericMarketRegime`) so a level can never be "read off the pixels"
 * without its numeric counterpart being present in the same payload.
 */

import { buildChartSnapshotBufferForMarket } from "@/lib/chartSnapshot";
import {
  canUseMt5ChartCapture,
  pollMt5ChartPng,
  queueMt5ChartCapture,
} from "@/lib/eaChartDraw";
import { canonicalizeInterval } from "@/lib/intervals";
import type { MarketType } from "@/lib/markets/types";
import { getUnifiedSnapshot } from "@/lib/markets";
import { fetchOhlc, type OhlcCandle } from "@/lib/ohlc/fetchOhlc";
import {
  detectNumericMarketRegime,
  MARKET_REGIME_THRESHOLDS,
  type MarketRegimeAnalysis,
} from "@/lib/ohlc/marketRegime";
import { detectStructureLevels } from "@/lib/ohlc/structure";
import {
  detectChartGeometry,
  summarizeGeometry,
  type GeometrySummary,
} from "@/lib/chart/geometry";
import {
  chartSnapshotCacheKey,
  getCachedChartSnapshot,
  setCachedChartSnapshot,
  type ChartSnapshotSource,
} from "./snapshotCache";

/** Balanced default: precise entry, immediate context, trend, big picture. */
export const DEFAULT_VISUAL_TIMEFRAMES = ["15m", "1h", "4h", "1d"] as const;
/** Default image budget — four charts keep the response inside a normal turn. */
export const DEFAULT_MAX_IMAGES = 4;
/** Hard ceiling regardless of what the caller asks for. */
export const MAX_IMAGES_LIMIT = 6;
/** Per-image wall clock. One slow timeframe must not sink the request. */
export const DEFAULT_IMAGE_TIMEOUT_MS = 8_000;
const MIN_IMAGE_TIMEOUT_MS = 2_000;
const MAX_IMAGE_TIMEOUT_MS = 20_000;
/** Share of the per-image budget given to native MT5 capture before fallback. */
const MT5_BUDGET_RATIO = 0.6;
/** Enough candles for the regime detector's 60-bar minimum plus its baseline. */
const NUMERIC_CANDLE_LIMIT = 240;

export type TimeframeSkipReason =
  | "unsupported_timeframe"
  | "duplicate_timeframe"
  | "max_images_exceeded";

export interface SkippedTimeframe {
  /** The label exactly as the caller supplied it. */
  timeframe: string;
  reason: TimeframeSkipReason;
}

export interface ResolvedTimeframes {
  timeframes: string[];
  skipped: SkippedTimeframe[];
  maxImages: number;
}

/**
 * Canonicalises and de-duplicates requested timeframes, then trims to the image
 * budget. Unsupported labels are reported rather than coerced — a silent
 * fallback to 1h would hand the model four copies of the same chart.
 */
export function resolveVisualTimeframes(
  requested: readonly string[] | undefined,
  maxImages?: number,
): ResolvedTimeframes {
  const budget = Math.max(
    1,
    Math.min(
      MAX_IMAGES_LIMIT,
      Number.isFinite(maxImages) ? Math.floor(maxImages as number) : DEFAULT_MAX_IMAGES,
    ),
  );

  const source =
    requested && requested.length > 0
      ? requested
      : [...DEFAULT_VISUAL_TIMEFRAMES];

  const timeframes: string[] = [];
  const skipped: SkippedTimeframe[] = [];
  const seen = new Set<string>();

  for (const raw of source) {
    const label = String(raw ?? "").trim();
    if (!label) continue;
    const canonical = canonicalizeInterval(label);
    if (!canonical) {
      skipped.push({ timeframe: label, reason: "unsupported_timeframe" });
      continue;
    }
    if (seen.has(canonical)) {
      skipped.push({ timeframe: label, reason: "duplicate_timeframe" });
      continue;
    }
    if (timeframes.length >= budget) {
      skipped.push({ timeframe: label, reason: "max_images_exceeded" });
      continue;
    }
    seen.add(canonical);
    timeframes.push(canonical);
  }

  return { timeframes, skipped, maxImages: budget };
}

const TIMED_OUT = Symbol("timed_out");

/** Races a promise against a deadline without leaking the timer. */
async function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | typeof TIMED_OUT> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface CaptureTimeframeInput {
  symbol: string;
  interval: string;
  market: MarketType;
  timeoutMs?: number;
  /** Skip the short-TTL cache (forces a fresh render). */
  skipCache?: boolean;
}

export type CaptureTimeframeResult =
  | {
      ok: true;
      imageBase64: string;
      source: ChartSnapshotSource;
      capturedAt: number;
      fromCache: boolean;
    }
  | { ok: false; reason: string };

/**
 * One timeframe → one PNG. Prefers the operator's own MT5 chart (same pixels
 * they see) and falls back to the server-rendered chart, always inside the
 * caller's per-image budget.
 */
export async function captureTimeframeImage(
  userId: number,
  input: CaptureTimeframeInput,
): Promise<CaptureTimeframeResult> {
  const timeoutMs = Math.max(
    MIN_IMAGE_TIMEOUT_MS,
    Math.min(MAX_IMAGE_TIMEOUT_MS, input.timeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS),
  );
  const cacheKey = chartSnapshotCacheKey(
    userId,
    input.symbol,
    input.interval,
    input.market,
  );

  if (!input.skipCache) {
    const cached = getCachedChartSnapshot(cacheKey);
    if (cached) {
      return {
        ok: true,
        imageBase64: cached.imageBase64,
        source: cached.source,
        capturedAt: cached.capturedAt,
        fromCache: true,
      };
    }
  }

  const deadline = Date.now() + timeoutMs;
  const store = (
    imageBase64: string,
    source: ChartSnapshotSource,
  ): CaptureTimeframeResult => {
    const capturedAt = Date.now();
    setCachedChartSnapshot(cacheKey, { imageBase64, source, capturedAt });
    return { ok: true, imageBase64, source, capturedAt, fromCache: false };
  };

  let mt5Reason: string | null = null;
  try {
    const mt5 = await canUseMt5ChartCapture(userId, input.symbol);
    if (mt5.ok) {
      const captureKey = `mtf_${input.interval}_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const queued = await queueMt5ChartCapture(userId, {
        captureKey,
        symbol: input.symbol,
        interval: input.interval,
        drawings: [],
      });
      if (queued.queued) {
        const budget = Math.max(
          0,
          Math.min(
            Math.round(timeoutMs * MT5_BUDGET_RATIO),
            deadline - Date.now(),
          ),
        );
        const polled = await pollMt5ChartPng(userId, captureKey, {
          maxMs: budget,
        });
        if (polled.ok && polled.buffer) {
          return store(polled.buffer.toString("base64"), "mt5");
        }
        mt5Reason = `mt5_${polled.status}`;
      } else {
        mt5Reason = `mt5_${queued.reason ?? "queue_failed"}`;
      }
    } else {
      mt5Reason = `mt5_${mt5.reason ?? "unavailable"}`;
    }
  } catch (error) {
    mt5Reason = error instanceof Error ? `mt5_${error.message}` : "mt5_error";
  }

  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    return { ok: false, reason: mt5Reason ?? "capture_timeout" };
  }

  const rendered = await withDeadline(
    buildChartSnapshotBufferForMarket(
      userId,
      input.symbol.toUpperCase(),
      input.interval,
      input.market,
    ),
    remaining,
  );
  if (rendered === TIMED_OUT) {
    return { ok: false, reason: "capture_timeout" };
  }
  if (!rendered) {
    return { ok: false, reason: mt5Reason ?? "chart_render_unavailable" };
  }
  return store(rendered.toString("base64"), "quickchart");
}

export interface TimeframeNumericContext {
  price: number | null;
  rsi: number | null;
  adx: number | null;
  atr14: number | null;
  /** SMA-derived direction from the technical snapshot. */
  trend: string | null;
  /** Swing-structure classification from detect_levels. */
  structure: string | null;
  regime: string | null;
  regime_direction: string | null;
  nearest_support: number | null;
  nearest_resistance: number | null;
  supports: number[];
  resistances: number[];
  candle_count: number | null;
  /** Deterministic geometry: trendlines/channel/patterns with state — the
   *  numeric counterpart of the shapes visible in the same-frame image. */
  geometry: GeometrySummary | null;
  /** Which deterministic engine produced each group of numbers. */
  sources: Record<string, string>;
  /** Engines that failed for this timeframe (numbers above stay null). */
  errors?: string[];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function round(value: number | null | undefined, digits: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Fetches the candle window both structure and regime detection need. */
async function numericCandles(
  userId: number,
  symbol: string,
  interval: string,
  market: MarketType,
): Promise<OhlcCandle[]> {
  let ohlc = await fetchOhlc({
    userId,
    symbol,
    interval,
    market,
    limit: NUMERIC_CANDLE_LIMIT,
  });
  // The shared OHLC cache key is limit-agnostic: an earlier short request can
  // leave a payload too small for the regime detector's indicator window.
  if (ohlc.fromCache && ohlc.candles.length < MARKET_REGIME_THRESHOLDS.minimumCandles) {
    ohlc = await fetchOhlc({
      userId,
      symbol,
      interval,
      market,
      limit: NUMERIC_CANDLE_LIMIT,
      skipCache: true,
    });
  }
  return ohlc.candles;
}

/**
 * Numeric evidence for one timeframe. Partial by design: a failing engine
 * leaves its fields null and names itself in `errors` instead of discarding the
 * numbers that did resolve.
 */
export async function buildTimeframeNumericContext(
  userId: number,
  input: { symbol: string; interval: string; market: MarketType },
): Promise<TimeframeNumericContext> {
  const [snapshotResult, candlesResult] = await Promise.allSettled([
    getUnifiedSnapshot(input.symbol, input.market, input.interval, userId),
    numericCandles(userId, input.symbol, input.interval, input.market),
  ]);

  const errors: string[] = [];
  const sources: Record<string, string> = {};

  let price: number | null = null;
  let rsi: number | null = null;
  let trend: string | null = null;
  if (snapshotResult.status === "fulfilled") {
    const snapshot = snapshotResult.value;
    const extra = (snapshot.extra ?? {}) as Record<string, unknown>;
    price = round(snapshot.price, 6);
    rsi = round(
      typeof extra.rsi14 === "number" ? extra.rsi14 : null,
      2,
    );
    trend = typeof extra.trend === "string" ? extra.trend : null;
    sources.price = "get_market_snapshot";
    sources.rsi = "get_market_snapshot";
    sources.trend = "get_market_snapshot";
  } else {
    errors.push(`market_snapshot: ${errorText(snapshotResult.reason)}`);
  }

  let adx: number | null = null;
  let atr14: number | null = null;
  let regime: string | null = null;
  let regimeDirection: string | null = null;
  let structure: string | null = null;
  let nearestSupport: number | null = null;
  let nearestResistance: number | null = null;
  let supports: number[] = [];
  let resistances: number[] = [];
  let candleCount: number | null = null;
  let geometry: GeometrySummary | null = null;

  if (candlesResult.status === "fulfilled") {
    const candles = candlesResult.value;
    candleCount = candles.length;

    try {
      const levels = detectStructureLevels(
        input.symbol.toUpperCase(),
        input.interval,
        candles,
      );
      structure = levels.structure;
      nearestSupport = round(levels.nearestSupport, 6);
      nearestResistance = round(levels.nearestResistance, 6);
      supports = levels.supports
        .slice(0, 3)
        .map((level) => round(level.price, 6))
        .filter((value): value is number => value != null);
      resistances = levels.resistances
        .slice(0, 3)
        .map((level) => round(level.price, 6))
        .filter((value): value is number => value != null);
      if (price == null) price = round(levels.currentPrice, 6);
      sources.levels = "detect_levels";
      sources.structure = "detect_levels";
    } catch (error) {
      errors.push(`detect_levels: ${errorText(error)}`);
    }

    try {
      const analysis: MarketRegimeAnalysis = detectNumericMarketRegime(candles);
      adx = round(analysis.metrics.adx14, 2);
      atr14 = round(analysis.metrics.atr14, 6);
      regime = analysis.regime;
      regimeDirection = analysis.trendDirection;
      sources.adx = "detect_market_regime";
      sources.regime = "detect_market_regime";
    } catch (error) {
      errors.push(`detect_market_regime: ${errorText(error)}`);
    }

    try {
      const snapshot = detectChartGeometry({ candles, atr: atr14 });
      geometry = summarizeGeometry(snapshot);
      sources.geometry = "detect_chart_geometry";
    } catch (error) {
      errors.push(`detect_chart_geometry: ${errorText(error)}`);
    }
  } else {
    errors.push(`ohlc: ${errorText(candlesResult.reason)}`);
  }

  return {
    price,
    rsi,
    adx,
    atr14,
    trend,
    structure,
    regime,
    regime_direction: regimeDirection,
    nearest_support: nearestSupport,
    nearest_resistance: nearestResistance,
    supports,
    resistances,
    candle_count: candleCount,
    geometry,
    sources,
    ...(errors.length ? { errors } : {}),
  };
}

export interface TimeframeSnapshot {
  timeframe: string;
  content_type: "image/png";
  image_base64: string;
  captured_at: string;
  image_source: ChartSnapshotSource;
  from_cache: boolean;
  numeric_context: TimeframeNumericContext | null;
}

export interface MissingTimeframe {
  timeframe: string;
  reason: string;
}

export interface MultiTimeframeCaptureInput {
  symbol: string;
  timeframes?: readonly string[];
  market?: MarketType;
  maxImages?: number;
  imageTimeoutMs?: number;
  includeNumericContext?: boolean;
  skipCache?: boolean;
}

export interface MultiTimeframeCaptureResult {
  symbol: string;
  market: MarketType;
  requested_timeframes: string[];
  captured_timeframes: string[];
  missing_timeframes: MissingTimeframe[];
  partial_success: boolean;
  snapshots: TimeframeSnapshot[];
  elapsed_ms: number;
  guardrails: string[];
}

/**
 * Contract reminders travelling with every payload, so the rules survive a
 * context window that no longer holds the tool documentation.
 */
export const VISUAL_EVIDENCE_GUARDRAILS = [
  "Images confirm shape only (rejection candle, gap, formation). Every precise level must come from numeric_context / detect_levels — never read off the pixels.",
  "Visual agreement never authorises live execution. Backtest evidence, calibrated confidence, and the minimum trade-count gate remain the only execution authority.",
  "State explicitly in the recommendation whether visual and numeric evidence agree, and pass visual_confirmation to create_recommendation so the disagreement is recorded rather than dropped.",
];

/**
 * Captures every requested timeframe concurrently. A failure in one timeframe
 * is reported in `missing_timeframes` and never fails the whole request.
 */
export async function captureMultiTimeframeSnapshot(
  userId: number,
  input: MultiTimeframeCaptureInput,
): Promise<MultiTimeframeCaptureResult> {
  const startedAt = Date.now();
  const market: MarketType = input.market ?? "forex";
  const symbol = input.symbol.trim().replace(/[\s/_-]+/g, "");
  const includeNumeric = input.includeNumericContext !== false;

  const { timeframes, skipped } = resolveVisualTimeframes(
    input.timeframes,
    input.maxImages,
  );

  const missing: MissingTimeframe[] = skipped.map((entry) => ({
    timeframe: entry.timeframe,
    reason: entry.reason,
  }));

  const results = await Promise.all(
    timeframes.map(async (timeframe) => {
      // Image and numbers for one timeframe are independent — run them
      // together so the numeric work costs no extra wall clock.
      const [image, numeric] = await Promise.all([
        captureTimeframeImage(userId, {
          symbol,
          interval: timeframe,
          market,
          timeoutMs: input.imageTimeoutMs,
          skipCache: input.skipCache,
        }).catch((error): CaptureTimeframeResult => ({
          ok: false,
          reason: errorText(error),
        })),
        includeNumeric
          ? buildTimeframeNumericContext(userId, {
              symbol,
              interval: timeframe,
              market,
            }).catch((): TimeframeNumericContext | null => null)
          : Promise.resolve(null),
      ]);
      return { timeframe, image, numeric };
    }),
  );

  const snapshots: TimeframeSnapshot[] = [];
  for (const { timeframe, image, numeric } of results) {
    if (!image.ok) {
      missing.push({ timeframe, reason: image.reason });
      continue;
    }
    snapshots.push({
      timeframe,
      content_type: "image/png",
      image_base64: image.imageBase64,
      captured_at: new Date(image.capturedAt).toISOString(),
      image_source: image.source,
      from_cache: image.fromCache,
      numeric_context: numeric,
    });
  }

  return {
    symbol: symbol.toUpperCase(),
    market,
    requested_timeframes: timeframes,
    captured_timeframes: snapshots.map((s) => s.timeframe),
    missing_timeframes: missing,
    partial_success: missing.length > 0 && snapshots.length > 0,
    snapshots,
    elapsed_ms: Date.now() - startedAt,
    guardrails: VISUAL_EVIDENCE_GUARDRAILS,
  };
}
