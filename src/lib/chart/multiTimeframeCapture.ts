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

import { LIVE_CAPTURE_ACK_MS, type PlatformCaptureDrawing } from "@/lib/chart/liveCapture";
import {
  captureChartWithPlatformFallback,
  loadLayoutOverlays,
} from "@/lib/chart/platformCapture";
import { canonicalizeInterval } from "@/lib/intervals";
import type { MarketType } from "@/lib/markets/types";
import { getUnifiedSnapshot } from "@/lib/markets";
import {
  bollinger as bollingerIndicator,
  macd as macdIndicator,
  stochastic as stochasticIndicator,
} from "@/lib/indicators";
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
import { type ChartSnapshotSource } from "./snapshotCache";

/** Balanced default: precise entry, immediate context, trend, big picture. */
export const DEFAULT_VISUAL_TIMEFRAMES = ["15m", "1h", "4h", "1d"] as const;
/** Default image budget — four charts keep the response inside a normal turn. */
export const DEFAULT_MAX_IMAGES = 4;
/** Hard ceiling regardless of what the caller asks for. */
export const MAX_IMAGES_LIMIT = 6;
/** Per-image wall clock. One slow timeframe must not sink the request. */
export const DEFAULT_IMAGE_TIMEOUT_MS = 16_000;
const MIN_IMAGE_TIMEOUT_MS = 2_000;
/** Ceiling for ONE render's budget, before any queue is accounted for. */
const MAX_IMAGE_TIMEOUT_MS = 20_000;
/**
 * Ceiling for a frame that also has to wait out its batch.
 *
 * One tab renders a batch serially, so a 4-frame request legitimately spans
 * four renders. This bounds that wait so a wedged tab still fails in finite
 * time instead of holding the visual stage open to its own deadline.
 */
const MAX_BATCH_TIMEOUT_MS = 45_000;

/**
 * The two deadlines one frame is judged against, given the queue behind it.
 *
 * Pure and exported because this arithmetic is the whole bug: a batch is
 * DISPATCHED concurrently but RENDERED serially by one chart tab, so sizing
 * either budget as though the frame were alone kills the tail of every batch.
 * Both scale with `queueDepth` — `ack` because the tab cannot even acknowledge
 * a frame until it reaches it, `timeout` because the frame is not finished
 * until the tab has worked through everything ahead of it.
 */
export function captureBudgets(
  perRenderMs: number | undefined,
  queueDepth: number | undefined,
): { timeoutMs: number; ackTimeoutMs: number } {
  const depth = Math.max(1, Math.floor(queueDepth ?? 1));
  const render = Math.max(
    MIN_IMAGE_TIMEOUT_MS,
    Math.min(MAX_IMAGE_TIMEOUT_MS, perRenderMs ?? DEFAULT_IMAGE_TIMEOUT_MS),
  );
  return {
    timeoutMs: Math.min(MAX_BATCH_TIMEOUT_MS, render * depth),
    ackTimeoutMs: Math.min(MAX_BATCH_TIMEOUT_MS, LIVE_CAPTURE_ACK_MS * depth),
  };
}
/** Enough candles for the regime detector's 60-bar minimum plus its baseline. */
export const NUMERIC_CANDLE_LIMIT = 350;

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
  layoutId?: string;
  liveSession?: boolean;
  includeDrawings?: boolean;
  includeStudies?: boolean;
  /**
   * The requesting layout's stored overlays, rendered by the platform tab
   * when the operator's own tab is absent. `drawings_included` is measured
   * off the widget, so a frame that never carries the drawings can only ever
   * measure false — and the analysis is then reported as visually unreviewed
   * no matter how many charts it actually captured.
   */
  platformDrawings?: PlatformCaptureDrawing[];
  platformStudies?: PlatformCaptureDrawing[];
  /**
   * How many frames share the one chart tab with this one.
   *
   * The tab renders a batch strictly one at a time, so this frame may have to
   * wait for `queueDepth - 1` renders before the tab even acknowledges it.
   * Defaults to 1 — a lone capture, which is what a single-frame caller is.
   */
  queueDepth?: number;
}

export type CaptureTimeframeResult =
  | {
      ok: true;
      imageBase64: string;
      /** Both shots of the two-shot pair (context, zoom). */
      images: { label: string; image_base64: string }[];
      source: ChartSnapshotSource;
      capturedAt: number;
      fromCache: boolean;
      drawings_included: boolean;
      studies_included: boolean;
      fallback_reason?: string;
    }
  | { ok: false; reason: string };

/**
 * One timeframe → the two-shot TradingView pair, or a named failure.
 *
 * TradingView's client-side snapshot in a live browser session is the ONLY
 * image source — the operator's own tab first, else the platform's shared
 * chart session (chart-host container), whose page runs the same
 * takeClientScreenshot. This module itself consults no snapshot cache and
 * writes none: the platform path's moment-cache lives behind the fallback
 * and refuses anything older than its short window, so a stale substitute
 * still cannot become this run's eyes. A caller with neither tab gets
 * `{ ok: false }` and the analysis proceeds on numbers alone.
 */
export async function captureTimeframeImage(
  userId: number,
  input: CaptureTimeframeInput,
): Promise<CaptureTimeframeResult> {
  // `timeoutMs` from the caller is the budget for ONE render. The frame may
  // additionally have to wait out the rest of its batch on the shared tab, so
  // the deadline it is actually judged against is that budget times the queue.
  const { timeoutMs, ackTimeoutMs } = captureBudgets(
    input.timeoutMs,
    input.queueDepth,
  );

  // A frame may be QUEUED behind its own batch, and waiting is not failing.
  //
  // One chart tab renders one frame at a time (`ChartHostAgent` runs
  // `for (…) await processOne(…)`), but a batch is dispatched all at once.
  // So frame N is not merely slow to render — it is not SEEN by the tab until
  // the N-1 frames ahead of it have finished. Measured live: one frame takes
  // ~4.2s, so the third frame of a batch is first acknowledged around 8.4s.
  // Against the flat 8s ack ceiling that arrived a few hundred milliseconds
  // late, and the frame was killed for being in a queue — which is why every
  // analysis lost its last frames while a single capture of the SAME frame
  // succeeded in 4.2s.
  //
  // Both budgets come from `captureBudgets` above, which scales them with the
  // queue rather than pretending each frame is alone on the tab.
  const captured = await withDeadline(
    captureChartWithPlatformFallback({
      userId,
      layoutId: input.layoutId,
      symbol: input.symbol,
      interval: input.interval,
      market: input.market,
      liveSession: input.liveSession,
      includeDrawings: input.includeDrawings,
      includeStudies: input.includeStudies,
      platformDrawings: input.platformDrawings,
      platformStudies: input.platformStudies,
      // `fresh=true` from the caller skips the platform moment-cache read.
      bypassCache: input.skipCache === true,
      ackTimeoutMs,
    }),
    timeoutMs,
  );
  if (captured === TIMED_OUT) {
    return { ok: false, reason: "capture_timeout" };
  }
  if (!captured.ok) {
    return { ok: false, reason: captured.reason };
  }
  return {
    ok: true,
    imageBase64: captured.image_base64,
    images: captured.images,
    source: captured.image_source,
    capturedAt: Date.now(),
    // True only when the platform moment-cache answered — same capture,
    // same short window, stated rather than passed off as a fresh shot.
    fromCache: captured.fromCache === true,
    drawings_included: captured.drawings_included,
    studies_included: captured.studies_included,
    fallback_reason: captured.fallback_reason,
  };
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
  /** MACD line/signal/histogram of the same closes the image shows. */
  macd: { macd: number; signal: number; histogram: number } | null;
  /** Bollinger read: band levels plus %B (0=lower, 1=upper) and width. */
  bollinger: {
    upper: number;
    middle: number;
    lower: number;
    percent_b: number;
    width_pct: number;
  } | null;
  /** Stochastic %K/%D, both 0–100. */
  stochastic: { k: number; d: number } | null;
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
  let macdOut: TimeframeNumericContext["macd"] = null;
  let bollingerOut: TimeframeNumericContext["bollinger"] = null;
  let stochasticOut: TimeframeNumericContext["stochastic"] = null;

  if (candlesResult.status === "fulfilled") {
    const candles = candlesResult.value;
    candleCount = candles.length;

    // Momentum/volatility oscillators from the SAME closes the image shows —
    // local math (lib/indicators), null on short windows, never guessed.
    try {
      const closes = candles.map((c) => c.close);
      const m = macdIndicator(closes);
      if (m) {
        macdOut = {
          macd: round(m.macd, 6)!,
          signal: round(m.signal, 6)!,
          histogram: round(m.histogram, 6)!,
        };
      }
      const bb = bollingerIndicator(closes);
      if (bb) {
        bollingerOut = {
          upper: round(bb.upper, 6)!,
          middle: round(bb.middle, 6)!,
          lower: round(bb.lower, 6)!,
          percent_b: round(bb.percentB, 3)!,
          width_pct: round(bb.widthPct, 4)!,
        };
      }
      const st = stochasticIndicator(
        candles.map((c) => ({ high: c.high, low: c.low, close: c.close })),
      );
      if (st) {
        stochasticOut = { k: round(st.k, 2)!, d: round(st.d, 2)! };
      }
      if (macdOut || bollingerOut || stochasticOut) {
        sources.oscillators = "lib_indicators";
      }
    } catch (error) {
      errors.push(`oscillators: ${errorText(error)}`);
    }

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
    macd: macdOut,
    bollinger: bollingerOut,
    stochastic: stochasticOut,
    geometry,
    sources,
    ...(errors.length ? { errors } : {}),
  };
}

export interface TimeframeSnapshot {
  timeframe: string;
  content_type: "image/png";
  image_base64: string;
  /** The two-shot pair (context, zoom) this timeframe was captured as. */
  images: { label: string; image_base64: string }[];
  captured_at: string;
  image_source: ChartSnapshotSource;
  from_cache: boolean;
  drawings_included: boolean;
  studies_included: boolean;
  fallback_reason?: string;
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
  layoutId?: string;
  liveSession?: boolean;
  includeDrawings?: boolean;
  includeStudies?: boolean;
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
  "Every image here is a TradingView client capture from a live browser session — there is no other source. When no live session exists there is NO image: say you analysed numbers alone, never describe a chart you were not shown.",
  "Each timeframe arrives as a two-shot pair: a wide context frame and a zoomed detail frame of the SAME chart. Use the zoom for candle shape, the context for structure.",
  "drawings_included=false forces visual_confirmation to not_checked. Do not report confirmed against a picture that omitted the drawings.",
];

/** Test seam for the batch: the per-frame capture and the overlay loader. */
export interface MultiTimeframeCaptureDeps {
  capture?: typeof captureTimeframeImage;
  loadOverlays?: typeof loadLayoutOverlays;
}

/**
 * Captures every requested timeframe concurrently. A failure in one timeframe
 * is reported in `missing_timeframes` and never fails the whole request.
 */
export async function captureMultiTimeframeSnapshot(
  userId: number,
  input: MultiTimeframeCaptureInput,
  deps: MultiTimeframeCaptureDeps = {},
): Promise<MultiTimeframeCaptureResult> {
  const startedAt = Date.now();
  const market: MarketType = input.market ?? "forex";
  const symbol = input.symbol.trim().replace(/[\s/_-]+/g, "");
  const includeNumeric = input.includeNumericContext !== false;
  const capture = deps.capture ?? captureTimeframeImage;

  const { timeframes, skipped } = resolveVisualTimeframes(
    input.timeframes,
    input.maxImages,
  );

  const missing: MissingTimeframe[] = skipped.map((entry) => ({
    timeframe: entry.timeframe,
    reason: entry.reason,
  }));

  // The requesting layout's own drawings travel with every frame, exactly as
  // they always have on the single-snapshot route. `drawings_included` is
  // measured off the widget at capture time, and a frame that never carried
  // the drawings can only measure false — which graded every unattended
  // analysis "visually unreviewed" no matter how many charts it captured.
  // Loaded ONCE for the batch; a layout with nothing drawn ships nothing and
  // the moment-cache behaviour is unchanged.
  const overlays = await (deps.loadOverlays ?? loadLayoutOverlays)(
    userId,
    input.layoutId,
  ).catch(() => ({ drawings: [], studies: [] }));
  const platformDrawings =
    input.includeDrawings === false ? [] : overlays.drawings;
  const platformStudies =
    input.includeStudies === false ? [] : overlays.studies;

  const results = await Promise.all(
    timeframes.map(async (timeframe) => {
      // Image and numbers for one timeframe are independent — run them
      // together so the numeric work costs no extra wall clock.
      const [image, numeric] = await Promise.all([
        capture(userId, {
          symbol,
          interval: timeframe,
          market,
          timeoutMs: input.imageTimeoutMs,
          skipCache: input.skipCache,
          layoutId: input.layoutId,
          liveSession: input.liveSession,
          includeDrawings: input.includeDrawings,
          includeStudies: input.includeStudies,
          platformDrawings,
          platformStudies,
          // These frames share ONE tab that renders them one at a time, so
          // each must be allowed to wait for the others. Without this the
          // batch dispatches concurrently and then times out serially.
          queueDepth: timeframes.length,
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
      images: image.images,
      captured_at: new Date(image.capturedAt).toISOString(),
      image_source: image.source,
      from_cache: image.fromCache,
      drawings_included: image.drawings_included,
      studies_included: image.studies_included,
      fallback_reason: image.fallback_reason,
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
