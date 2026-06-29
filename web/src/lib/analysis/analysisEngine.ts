import type { OhlcCandle } from "@/lib/ohlc/fetchOhlc";
import { computeForexIndicators } from "@/lib/ohlc/indicators";
import { detectStructureLevels } from "@/lib/ohlc/structure";
import type { ChartDrawing } from "@/lib/chartDrawings";
import { analyzeLevels } from "./levels";
import { analyzeFib } from "./fib";
import { analyzeChannels } from "./channels";
import { analyzeTrendlines } from "./trendlines";
import { detectPatterns, patternLabel, type PatternResult } from "./patterns";
import { analyzeConfluence, type ConfluenceResult } from "./confluence";
import { priceLineDrawing } from "./drawings";

export interface TradeSuggestion {
  decision: "buy" | "sell" | "hold";
  entry: number;
  stop: number | null;
  targets: number[];
  rr: number | null;
  confidence: number;
  reason: string;
}

export interface MarketAnalysis {
  symbol: string;
  interval: string;
  generatedAt: number;
  currentPrice: number;
  trend: "uptrend" | "downtrend" | "sideways";
  structure: "uptrend" | "downtrend" | "range" | "unknown";
  indicators: {
    rsi14: number | null;
    macdHistogram: number | null;
    atr14: number | null;
    ema20: number | null;
    sma20: number | null;
    sma50: number | null;
    summary: string;
  };
  levels: {
    nearestSupport: number | null;
    nearestResistance: number | null;
    supports: number[];
    resistances: number[];
    supplyDemandZones: { kind: string; top: number; bottom: number }[];
    liquidity: { kind: string; price: number; touches: number }[];
    breaks: { kind: string; direction: string; price: number }[];
  };
  fib: {
    direction: "up" | "down" | null;
    nearest: { ratio: number; price: number } | null;
  };
  channel: { present: boolean; direction: string | null };
  patterns: {
    type: string;
    label: string;
    bias: string;
    breakLevel: number;
    target: number;
    confidence: number;
  }[];
  selectedPattern: string | null;
  confluence: ConfluenceResult;
  timeframeAlignment: {
    higherInterval: string | null;
    higherTrend: string | null;
    aligned: boolean | null;
  };
  suggestion: TradeSuggestion;
}

export interface AnalysisResult {
  analysis: MarketAnalysis;
  drawings: ChartDrawing[];
}

export interface AnalyzeOptions {
  /** Higher-timeframe candles for alignment (optional). */
  higherCandles?: OhlcCandle[];
  higherInterval?: string;
}

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; lastBar: number; result: AnalysisResult }>();

function trendToStructure(t: string): "uptrend" | "downtrend" | "sideways" {
  if (t === "uptrend") return "uptrend";
  if (t === "downtrend") return "downtrend";
  return "sideways";
}

function buildSuggestion(
  currentPrice: number,
  atr: number | null,
  confluence: ConfluenceResult,
  nearestSupport: number | null,
  nearestResistance: number | null,
  bestPattern: PatternResult | null,
  fibTargets: number[],
): TradeSuggestion {
  const decision: TradeSuggestion["decision"] =
    confluence.bias === "bullish" ? "buy" : confluence.bias === "bearish" ? "sell" : "hold";

  if (decision === "hold") {
    return {
      decision,
      entry: currentPrice,
      stop: null,
      targets: [],
      rr: null,
      confidence: confluence.confidence,
      reason: "إشارات متعارضة — لا أفضلية واضحة حالياً.",
    };
  }

  const atrUnit = atr && atr > 0 ? atr : currentPrice * 0.003;
  const entry = currentPrice;

  let stop: number;
  const targetPool: number[] = [];
  if (decision === "buy") {
    stop = Math.min(
      nearestSupport != null && nearestSupport < entry ? nearestSupport : entry - atrUnit * 1.5,
      entry - atrUnit * 1.2,
    );
    if (nearestResistance != null && nearestResistance > entry) targetPool.push(nearestResistance);
    if (bestPattern?.bias === "bullish" && bestPattern.target > entry) targetPool.push(bestPattern.target);
    for (const t of fibTargets) if (t > entry) targetPool.push(t);
    targetPool.push(entry + atrUnit * 2, entry + atrUnit * 3.5);
  } else {
    stop = Math.max(
      nearestResistance != null && nearestResistance > entry ? nearestResistance : entry + atrUnit * 1.5,
      entry + atrUnit * 1.2,
    );
    if (nearestSupport != null && nearestSupport < entry) targetPool.push(nearestSupport);
    if (bestPattern?.bias === "bearish" && bestPattern.target < entry) targetPool.push(bestPattern.target);
    for (const t of fibTargets) if (t < entry) targetPool.push(t);
    targetPool.push(entry - atrUnit * 2, entry - atrUnit * 3.5);
  }

  const targets = dedupeSorted(targetPool, decision === "buy").slice(0, 3);
  const risk = Math.abs(entry - stop);
  const firstTarget = targets[0];
  const rr = risk > 0 && firstTarget != null ? Math.abs(firstTarget - entry) / risk : null;

  return {
    decision,
    entry,
    stop,
    targets,
    rr: rr != null ? Math.round(rr * 100) / 100 : null,
    confidence: confluence.confidence,
    reason: confluence.reasons.slice(0, 4).join(" · "),
  };
}

function dedupeSorted(values: number[], ascending: boolean): number[] {
  const uniq: number[] = [];
  for (const v of values.sort((a, b) => (ascending ? a - b : b - a))) {
    if (!uniq.some((u) => Math.abs(u - v) / (Math.abs(v) || 1) < 0.0005)) uniq.push(v);
  }
  return uniq;
}

/**
 * Precompute the entire technical analysis in TypeScript — indicators,
 * structure, S/R, supply/demand, fib, channels, trendlines, patterns, break
 * levels, timeframe alignment and a confluence-scored trade suggestion — plus
 * ready-to-render ChartDrawing[]. The model reasons on top of this; it does not
 * discover via many tool calls.
 */
export function runAnalysisEngine(
  symbol: string,
  interval: string,
  candles: OhlcCandle[],
  opts: AnalyzeOptions = {},
): AnalysisResult {
  const lastBar = candles[candles.length - 1]?.time ?? 0;
  const key = `${symbol.toUpperCase()}:${interval}`;
  const hit = cache.get(key);
  if (hit && hit.lastBar === lastBar && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.result;
  }

  const indicators = computeForexIndicators(symbol, interval, candles, "mt5_ohlc");
  const structure = detectStructureLevels(symbol, interval, candles);
  const levels = analyzeLevels(symbol, interval, candles);
  const fib = analyzeFib(candles);
  const channel = analyzeChannels(candles);
  const trendlines = analyzeTrendlines(candles);
  const patterns = detectPatterns(candles);
  const bestPattern = patterns[0] ?? null;

  const higherTrend = opts.higherCandles
    ? computeForexIndicators(symbol, opts.higherInterval ?? interval, opts.higherCandles, "mt5_ohlc").trend
    : null;

  const confluence = analyzeConfluence({
    indicators,
    breaks: levels.breaks,
    pattern: bestPattern,
    higherTrend,
  });

  const currentPrice = candles[candles.length - 1]?.close ?? structure.currentPrice;
  const fibTargets = fib.levels.filter((l) => l.ratio >= 1).map((l) => l.price);

  const suggestion = buildSuggestion(
    currentPrice,
    indicators.atr14,
    confluence,
    levels.nearestSupport,
    levels.nearestResistance,
    bestPattern,
    fibTargets,
  );

  const aligned =
    higherTrend && higherTrend !== "sideways"
      ? (higherTrend === "uptrend" && confluence.bias === "bullish") ||
        (higherTrend === "downtrend" && confluence.bias === "bearish")
      : null;

  const drawings: ChartDrawing[] = [
    ...levels.drawings,
    ...fib.drawings,
    ...channel.drawings,
    ...trendlines.drawings,
    ...(bestPattern?.drawings ?? []),
  ];
  if (suggestion.stop != null && suggestion.decision !== "hold") {
    drawings.push(
      priceLineDrawing(
        suggestion.stop,
        suggestion.confidence,
        "وقف الخسارة",
        candles,
        "#ef4444",
        "stop_loss",
      ),
    );
  }
  if (suggestion.decision !== "hold") {
    suggestion.targets.forEach((t, i) =>
      drawings.push(
        priceLineDrawing(
          t,
          suggestion.confidence,
          `الهدف ${i + 1}`,
          candles,
          "#22c55e",
          "take_profit",
        ),
      ),
    );
  }

  const analysis: MarketAnalysis = {
    symbol: symbol.toUpperCase(),
    interval,
    generatedAt: Date.now(),
    currentPrice,
    trend: indicators.trend,
    structure: structure.structure,
    indicators: {
      rsi14: indicators.rsi14,
      macdHistogram: indicators.macd?.histogram ?? null,
      atr14: indicators.atr14,
      ema20: indicators.ema20,
      sma20: indicators.sma20,
      sma50: indicators.sma50,
      summary: indicators.summary,
    },
    levels: {
      nearestSupport: levels.nearestSupport,
      nearestResistance: levels.nearestResistance,
      supports: levels.supports,
      resistances: levels.resistances,
      supplyDemandZones: levels.zones.map((z) => ({ kind: z.kind, top: z.top, bottom: z.bottom })),
      liquidity: levels.liquidity.map((l) => ({ kind: l.kind, price: l.price, touches: l.touches })),
      breaks: levels.breaks.map((b) => ({ kind: b.kind, direction: b.direction, price: b.price })),
    },
    fib: {
      direction: fib.direction,
      nearest: fib.nearestLevel ? { ratio: fib.nearestLevel.ratio, price: fib.nearestLevel.price } : null,
    },
    channel: { present: channel.present, direction: channel.direction },
    patterns: patterns.slice(0, 3).map((p) => ({
      type: p.type,
      label: patternLabel(p.type),
      bias: p.bias,
      breakLevel: p.breakLevel,
      target: p.target,
      confidence: p.confidence,
    })),
    selectedPattern: bestPattern ? patternLabel(bestPattern.type) : null,
    confluence,
    timeframeAlignment: {
      higherInterval: opts.higherInterval ?? null,
      higherTrend,
      aligned,
    },
    suggestion,
  };

  const result: AnalysisResult = { analysis, drawings };
  cache.set(key, { at: Date.now(), lastBar, result });
  return result;
}

/** Compact, model-friendly serialization (drawings excluded — those go to the chart). */
export function analysisToPrompt(a: MarketAnalysis): string {
  return JSON.stringify(a);
}

function fmt(n: number | null | undefined): string {
  return n == null ? "—" : Number(n).toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Readable Arabic block of the precomputed analysis, injected into the prompt so
 * the model validates/ranks and writes the trade plan instead of discovering via
 * many tool calls. It is the finished analysis, not raw data.
 */
export function formatAnalysisForPrompt(a: MarketAnalysis): string {
  const s = a.suggestion;
  const lines: string[] = [
    `— تحليل فني مُسبق (محسوب في TypeScript، اعتمد عليه ولا تُعِد اكتشافه) —`,
    `الاتجاه: ${a.trend} · البنية: ${a.structure} · ${a.indicators.summary}`,
    `RSI ${fmt(a.indicators.rsi14)} · MACD-hist ${fmt(a.indicators.macdHistogram)} · ATR ${fmt(a.indicators.atr14)}`,
    `أقرب دعم ${fmt(a.levels.nearestSupport)} · أقرب مقاومة ${fmt(a.levels.nearestResistance)}`,
  ];
  if (a.levels.breaks.length) {
    lines.push(
      `كسر هيكلي: ${a.levels.breaks.map((b) => `${b.kind} ${b.direction} @${fmt(b.price)}`).join(" · ")}`,
    );
  }
  if (a.selectedPattern) {
    const p = a.patterns[0]!;
    lines.push(
      `النمط المرشّح: ${p.label} (${p.bias}, ثقة ${p.confidence}%) كسر@${fmt(p.breakLevel)} هدف@${fmt(p.target)}`,
    );
  }
  if (a.channel.present) lines.push(`قناة: ${a.channel.direction}`);
  if (a.fib.nearest) {
    lines.push(`أقرب فيبوناتشي: ${a.fib.nearest.ratio} @${fmt(a.fib.nearest.price)}`);
  }
  lines.push(
    `confluence: ${a.confluence.bias} (ثقة ${a.confluence.confidence}%) — ${a.confluence.reasons.join("، ")}`,
  );
  lines.push(
    `اقتراح آلي (راجِعه، لا تلتزم به حرفياً): ${s.decision} · دخول ${fmt(s.entry)} · وقف ${fmt(s.stop)} · أهداف ${s.targets.map(fmt).join("، ") || "—"} · R:R ${s.rr ?? "—"}`,
  );
  return lines.join("\n");
}
