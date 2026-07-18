/**
 * Neutral pre-decision evidence — no candidates, playbook scores, or preferred side.
 */
import type { AgentMarketContext } from "../marketContext/buildAgentMarketContext";
import type { StructureResult } from "../agents/structureAgent";
import type { SupplyDemandResult } from "../agents/supplyDemandAgent";
import type { LiquidityResult } from "../agents/liquidityAgent";
import type { MultiTimeframeResult } from "../agents/multiTimeframeAgent";
import type { NewsMacroResult } from "../agents/newsMacroAgent";
import type { MarketNarrative } from "../marketContext/buildMarketNarrative";
import { summarizeChartDrawings } from "../chartDrawingContext";
import type { ChartDrawing } from "@/lib/chartDrawings";
import { SCALPING_CONTEXT } from "@/lib/productModel";
import type { MarketSnapshot } from "./marketSnapshot";
import type { VisionImageMeta } from "./neutralVision";

const BOUND = {
  levels: 8,
  events: 12,
  swings: 16,
  sweeps: 10,
} as const;

export type NeutralMarketEvidence = {
  scalpingContext: typeof SCALPING_CONTEXT;
  snapshot: {
    snapshotId: string;
    symbol: string;
    primaryTimeframe: string;
    timeframeSelectionSource: string;
    contextTimeframes: string[];
    brokerOrSource: string;
    bid: number | null;
    ask: number | null;
    mid: number | null;
    spread: number | null;
    quoteMarketTimestamp: number | null;
    quoteServerReceiveTimestamp: number;
    quoteAgeMs: number | null;
    pricePrecision: number | null;
    tickSize: number | null;
    marketOpen: boolean | null;
    serverTimestamp: number;
    sourceHealth: string;
    fingerprint: string;
    candleCoverage: MarketSnapshot["candleCoverage"];
    candleCloseTimes: MarketSnapshot["candleCloseTimes"];
  };
  candleEnvelopes: MarketSnapshot["envelopes"];
  atr: number | null;
  volatility: {
    atr: number | null;
    atrPctOfPrice: number | null;
  };
  narrative: MarketNarrative | null;
  structure: {
    trend: string | null;
    supportResistance: {
      support: Array<{ price: number; time?: number }>;
      resistance: Array<{ price: number; time?: number }>;
    };
    structureEvents: Array<{
      type: string;
      direction: string;
      brokenLevel: number;
      breakCandleTime: number;
      strength: number;
    }>;
    swings: Array<{
      type: string;
      price: number;
      time: number;
    }>;
  } | null;
  liquidity: {
    recentSweepCount: number;
    sweeps: Array<{
      side: string;
      sweptLevel: number;
      candleTime: number;
      wickExtreme: number;
      closeBackInside: boolean;
      strength: number;
      followedByStructureShift: boolean;
    }>;
  } | null;
  supplyDemand: {
    nearestDemand: unknown;
    nearestSupply: unknown;
    zoneCount: number;
  } | null;
  mtf: {
    currentBias: string | null;
    higherBias: string | null;
    dailyBias: string | null;
    conflict: boolean;
  } | null;
  news: {
    newsRisk: string;
    reason: string;
    upcomingEvents: Array<{
      title: string;
      time: string;
      impact: string;
      currency: string;
    }>;
  };
  timeframeFreshness: Array<{
    timeframe: string;
    role: string;
    source: string;
    availableCount: number;
    includedCount: number;
    lastCandleTime: number | null;
    capturedAt: number;
  }>;
  chartDrawingsSummary: ReturnType<typeof summarizeChartDrawings>;
  visionImages: VisionImageMeta[];
  userMessage: string;
  /** Session preference fact — never forces WAIT or direction. */
  educationalOnly: boolean;
};

export function buildNeutralEvidence(input: {
  snapshot: MarketSnapshot;
  market: AgentMarketContext;
  structure: StructureResult | null;
  supplyDemand: SupplyDemandResult | null;
  liquidity: LiquidityResult | null;
  mtf: MultiTimeframeResult | null;
  news: NewsMacroResult | null;
  narrative: MarketNarrative | null;
  chartDrawings?: ChartDrawing[];
  visionMetas: VisionImageMeta[];
  userMessage: string;
  educationalOnly?: boolean;
}): NeutralMarketEvidence {
  const mid = input.snapshot.mid;
  const atr = input.market.atr ?? null;
  const atrPctOfPrice =
    atr != null && mid != null && mid > 0 ? (atr / mid) * 100 : null;

  return {
    scalpingContext: SCALPING_CONTEXT,
    snapshot: {
      snapshotId: input.snapshot.snapshotId,
      symbol: input.snapshot.symbol,
      primaryTimeframe: input.snapshot.primaryTimeframe,
      timeframeSelectionSource: input.snapshot.scope.selectionSource,
      contextTimeframes: input.snapshot.scope.contextTimeframes,
      brokerOrSource: input.snapshot.brokerOrSource,
      bid: input.snapshot.bid,
      ask: input.snapshot.ask,
      mid: input.snapshot.mid,
      spread: input.snapshot.spread,
      quoteMarketTimestamp: input.snapshot.marketTimestamp,
      quoteServerReceiveTimestamp: input.snapshot.serverTimestamp,
      quoteAgeMs: input.snapshot.quoteAgeMs,
      pricePrecision: input.snapshot.pricePrecision,
      tickSize: input.snapshot.tickSize,
      marketOpen: input.snapshot.marketOpen,
      serverTimestamp: input.snapshot.serverTimestamp,
      sourceHealth: input.snapshot.sourceHealth,
      fingerprint: input.snapshot.fingerprint,
      candleCoverage: input.snapshot.candleCoverage,
      candleCloseTimes: input.snapshot.candleCloseTimes,
    },
    candleEnvelopes: input.snapshot.envelopes,
    atr,
    volatility: { atr, atrPctOfPrice },
    narrative: input.narrative,
    structure: input.structure
      ? {
          trend: input.structure.trend,
          supportResistance: {
            support: (input.structure.support ?? [])
              .slice(0, BOUND.levels)
              .map((level) => ({
                price: level.price,
                time: level.time,
              })),
            resistance: (input.structure.resistance ?? [])
              .slice(0, BOUND.levels)
              .map((level) => ({
                price: level.price,
                time: level.time,
              })),
          },
          structureEvents: (input.structure.structureEvents ?? [])
            .slice(-BOUND.events)
            .map((event) => ({
              type: event.type,
              direction: event.direction,
              brokenLevel: event.brokenLevel,
              breakCandleTime: event.breakCandleTime,
              strength: event.strength,
            })),
          swings: (input.structure.swings ?? [])
            .slice(-BOUND.swings)
            .map((swing) => ({
              type: swing.type,
              price: swing.price,
              time: swing.time,
            })),
        }
      : null,
    liquidity: input.liquidity
      ? {
          recentSweepCount: input.liquidity.sweeps?.length ?? 0,
          sweeps: (input.liquidity.sweeps ?? [])
            .slice(-BOUND.sweeps)
            .map((sweep) => ({
              side: sweep.side,
              sweptLevel: sweep.sweptLevel,
              candleTime: sweep.candleTime,
              wickExtreme: sweep.wickExtreme,
              closeBackInside: sweep.closeBackInside,
              strength: sweep.strength,
              followedByStructureShift: sweep.followedByStructureShift,
            })),
        }
      : null,
    supplyDemand: input.supplyDemand
      ? {
          nearestDemand: input.supplyDemand.nearestDemand ?? null,
          nearestSupply: input.supplyDemand.nearestSupply ?? null,
          zoneCount: input.supplyDemand.zones?.length ?? 0,
        }
      : null,
    mtf: input.mtf
      ? {
          currentBias: input.mtf.currentBias,
          higherBias: input.mtf.higherBias,
          dailyBias: input.mtf.dailyBias,
          conflict: Boolean(input.mtf.conflict),
        }
      : null,
    news: {
      newsRisk: input.news?.newsRisk ?? "unknown",
      reason: input.news?.reason ?? "News provider is not configured.",
      upcomingEvents:
        input.news?.upcomingEvents.slice(0, 8).map((e) => ({
          title: e.title,
          time: e.time,
          impact: e.impact,
          currency: e.currency ?? "",
        })) ?? [],
    },
    timeframeFreshness: input.snapshot.envelopes.map((env) => ({
      timeframe: env.timeframe,
      role: env.role,
      source: env.source,
      availableCount: env.availableCount,
      includedCount: env.includedCount,
      lastCandleTime: env.lastCandleTime,
      capturedAt: env.capturedAt,
    })),
    chartDrawingsSummary: summarizeChartDrawings(
      input.chartDrawings,
      input.market.currentPrice,
    ),
    visionImages: input.visionMetas,
    userMessage: input.userMessage.slice(0, 500),
    educationalOnly: Boolean(input.educationalOnly),
  };
}

/** Assert no candidate-authority keys leaked into the model payload. */
export function assertNoCandidateAuthority(payload: unknown): string[] {
  const forbidden = new Set([
    "candidate",
    "candidates",
    "selectedcandidate",
    "selectedtradecandidateid",
    "tradecandidates",
    "rejectedcandidatereasons",
    "candidatesresult",
    "candidatedirection",
    "candidatescore",
    "candidaterank",
    "preferreddirection",
    "selectedlevels",
    "rulebasedrecommendation",
    "playbook",
    "proposedtrade",
    "opportunitycandidate",
    "actionablecandidate",
    "topcandidate",
  ]);
  const leaks: string[] = [];
  const visit = (value: unknown, path: string): void => {
    if (value == null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const childPath = path ? `${path}.${key}` : key;
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (child != null && forbidden.has(normalized)) leaks.push(childPath);
      visit(child, childPath);
    }
  };
  visit(payload, "");
  return [...new Set(leaks)];
}
