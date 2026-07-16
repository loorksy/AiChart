/**
 * Replay harness — runs the SAME deterministic decision pipeline on a frozen
 * historical window ("current time" = the decision candle), so the trading
 * brain can be evaluated on past data. Pure: no I/O, no LLM, no warehouse —
 * candles in, decision out.
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
import {
  buildTradeCandidates,
  type TradeCandidate,
  type TradeCandidatesResult,
} from "../trading/buildTradeCandidates";

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

export interface ReplayDecision {
  decisionTime: number;
  decisionPrice: number;
  action: "buy" | "sell" | "wait";
  candidate: TradeCandidate | null;
  candidatesResult: TradeCandidatesResult;
  /** Candles AFTER the decision point (for outcome scoring). */
  futureCandles: AgentCandle[];
}

export function replayDecision(input: ReplayDecisionInput): ReplayDecision {
  const idx = Math.max(1, Math.min(input.decisionIndex, input.candles.length - 1));
  // Freeze time: the pipeline sees ONLY candles up to the decision candle.
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

  const candidatesResult = buildTradeCandidates({
    candles: visible,
    currentPrice: price,
    atr,
    trend: regime === "unknown" ? trend : trend,
    htfBias: input.htfBias ?? "unknown",
    htfConflict: input.htfConflict ?? false,
    zones,
    structureEvents,
    sweeps,
    rangePosition,
    htfLevels: [],
    newsRisk: input.newsRisk ?? "unknown",
    spread: input.spread ?? null,
  });

  return {
    decisionTime: decisionCandle.time,
    decisionPrice: price,
    action: candidatesResult.best?.action ?? "wait",
    candidate: candidatesResult.best,
    candidatesResult,
    futureCandles: future,
  };
}
