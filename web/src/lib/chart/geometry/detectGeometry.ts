/**
 * Geometry engine entry point — ONE call, bounded deterministic output.
 *
 * The same snapshot feeds every surface: the decision path (drawing plan +
 * synthesizer evidence), the live TradingView chart, the PNG snapshots, and
 * the MCP numeric context — so a triangle the model reasons about is the
 * exact triangle the operator sees drawn.
 *
 * Bounds: input capped at the last 500 candles; output at ≤2 trendlines/side,
 * ≤1 channel, ≤3 patterns, all above GEOMETRY_MIN_CONFIDENCE (env, default
 * 60). Overlapping claims dedupe to the higher confidence.
 */
import type {
  GeometryCandle,
  GeometryDetectorInput,
  GeometrySnapshot,
  PatternInstance,
} from "./types";
import { geometryAtr, zigzagPivots, allConfirmedPivots } from "./pivots";
import { detectTrendlines } from "./trendlines";
import { detectChannels } from "./channels";
import { detectConvergingPatterns } from "./triangles";
import { detectHeadShoulders } from "./headShoulders";
import { detectDoubleExtremes } from "./doubleExtremes";
import { detectFlags } from "./flags";

export const GEOMETRY_WINDOW_BARS = 500;
export const MIN_GEOMETRY_CANDLES = 60;
const MAX_PATTERNS = 3;
const DEFAULT_MIN_CONFIDENCE = 60;

export function geometryMinConfidence(): number {
  const raw = Number(process.env.GEOMETRY_MIN_CONFIDENCE);
  if (!Number.isFinite(raw) || raw < 0 || raw > 100) return DEFAULT_MIN_CONFIDENCE;
  return raw;
}

function emptySnapshot(candleCount: number, atr: number): GeometrySnapshot {
  return {
    pivots: [],
    trendlines: [],
    channels: [],
    patterns: [],
    candleCount,
    atr,
  };
}

/** Two patterns overlap when their anchor bar-spans share >60% of the shorter. */
function overlaps(a: PatternInstance, b: PatternInstance): boolean {
  const spanOf = (p: PatternInstance): [number, number] => {
    const indexes = p.anchors.map((anchor) => anchor.index);
    return [Math.min(...indexes), Math.max(...indexes)];
  };
  const [aFrom, aTo] = spanOf(a);
  const [bFrom, bTo] = spanOf(b);
  const intersection = Math.min(aTo, bTo) - Math.max(aFrom, bFrom);
  if (intersection <= 0) return false;
  const shorter = Math.max(1, Math.min(aTo - aFrom, bTo - bFrom));
  return intersection / shorter > 0.6;
}

export function detectChartGeometry(input: {
  candles: readonly GeometryCandle[];
  atr?: number | null;
}): GeometrySnapshot {
  const candles = input.candles.slice(-GEOMETRY_WINDOW_BARS) as GeometryCandle[];
  if (candles.length < MIN_GEOMETRY_CANDLES) {
    return emptySnapshot(candles.length, 0);
  }
  const atr =
    input.atr && input.atr > 0 ? input.atr : geometryAtr(candles);
  if (!(atr > 0)) return emptySnapshot(candles.length, 0);

  const zigzag = zigzagPivots(candles, atr);
  const detectorInput: GeometryDetectorInput = {
    candles,
    // Detectors that fit boundary lines want confirmed (denser) pivots;
    // template detectors (H&S, doubles) consume the zigzag explicitly.
    pivots: allConfirmedPivots(candles),
    atr,
  };

  const threshold = geometryMinConfidence();

  const trendlines = detectTrendlines(detectorInput).filter(
    (line) => line.confidence >= threshold,
  );
  const channels = detectChannels(detectorInput, trendlines).filter(
    (channel) => channel.confidence >= threshold,
  );

  const rawPatterns: PatternInstance[] = [
    ...detectConvergingPatterns(detectorInput),
    ...detectHeadShoulders(detectorInput, zigzag),
    ...detectDoubleExtremes(detectorInput, zigzag),
    ...detectFlags(detectorInput),
  ].filter((pattern) => pattern.confidence >= threshold);

  // Dedupe overlapping claims. Specificity outranks raw confidence: a flat-top
  // ascending triangle ALSO satisfies the looser double-top template (equal
  // highs), but the converging-boundary claim carries strictly more structure
  // (two fitted lines, apex, break rules) — so template richness wins the
  // overlap, then confidence breaks ties. Deterministic ordering throughout.
  const specificity = (pattern: PatternInstance): number => {
    switch (pattern.patternType) {
      case "head_and_shoulders":
      case "inverse_head_and_shoulders":
        return 3;
      case "ascending_triangle":
      case "descending_triangle":
      case "symmetrical_triangle":
      case "wedge":
        return 2;
      default:
        return 1;
    }
  };
  rawPatterns.sort(
    (a, b) =>
      specificity(b) - specificity(a) ||
      b.confidence - a.confidence ||
      a.patternType.localeCompare(b.patternType),
  );
  const patterns: PatternInstance[] = [];
  for (const candidate of rawPatterns) {
    if (patterns.length >= MAX_PATTERNS) break;
    if (patterns.every((kept) => !overlaps(kept, candidate))) {
      patterns.push(candidate);
    }
  }
  patterns.sort((a, b) => b.confidence - a.confidence);

  return {
    pivots: zigzag,
    trendlines,
    channels,
    patterns,
    candleCount: candles.length,
    atr,
  };
}
