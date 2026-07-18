/**
 * Historical market-fact replay — freezes candles at a decision index and
 * extracts neutral detectors only. Does NOT produce BUY/SELL/WAIT and does
 * not run any trade-proposal engine.
 */
import {
  calculateAtr,
  detectLiquidity,
  detectMarketRegime,
  detectSupplyDemandZones,
  detectSwings,
  detectTrend,
  type AgentCandle,
} from "../marketContext/detectors";
import { detectStructureEvents } from "../marketContext/structureEvents";
import {
  detectLiquiditySweeps,
  enrichSweepsWithStructure,
} from "../marketContext/liquiditySweeps";
import { computeRangePosition } from "../marketContext/rangePosition";

export interface ReplayDecisionInput {
  /** Full candle history (oldest → newest). */
  candles: AgentCandle[];
  /** Index of the decision candle — everything after it is hidden. */
  decisionIndex: number;
  htfBias?: "bullish" | "bearish" | "neutral" | "unknown";
  htfConflict?: boolean;
  newsRisk?: "low" | "medium" | "high" | "unknown";
  spread?: number | null;
}

export interface ReplayMarketFacts {
  decisionTime: number;
  decisionPrice: number;
  atr: number | null;
  trend: string | null;
  regime: string | null;
  zoneCount: number;
  structureEventCount: number;
  sweepCount: number;
  rangeLabel: string | null;
  /** Candles AFTER the decision point (for outcome scoring of model plans). */
  futureCandles: AgentCandle[];
}

/** @deprecated Use ReplayMarketFacts — kept name for import stability in tests. */
export type ReplayDecision = ReplayMarketFacts;

export function replayDecision(input: ReplayDecisionInput): ReplayMarketFacts {
  const idx = Math.max(1, Math.min(input.decisionIndex, input.candles.length - 1));
  const visible = input.candles.slice(0, idx + 1);
  const future = input.candles.slice(idx + 1);
  const decisionCandle = visible.at(-1)!;
  const price = decisionCandle.close;

  const atr = calculateAtr(visible);
  const swings = detectSwings(visible);
  const trend = detectTrend(swings);
  const regime = detectMarketRegime(visible);
  const zones = detectSupplyDemandZones(visible);
  const liquidity = detectLiquidity(visible);
  const structureEvents = detectStructureEvents(visible, swings, atr);
  const sweeps = enrichSweepsWithStructure(
    detectLiquiditySweeps({
      candles: visible,
      equalHighs: liquidity.equalHighs,
      equalLows: liquidity.equalLows,
      atr,
    }),
    structureEvents,
  );
  const rangePosition = computeRangePosition(visible, price);

  return {
    decisionTime: decisionCandle.time,
    decisionPrice: price,
    atr,
    trend,
    regime,
    zoneCount: zones.length,
    structureEventCount: structureEvents.length,
    sweepCount: sweeps.length,
    rangeLabel: rangePosition?.label ?? null,
    futureCandles: future,
  };
}
