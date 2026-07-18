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

export type NeutralMarketEvidence = {
  scalpingContext: typeof SCALPING_CONTEXT;
  snapshot: {
    snapshotId: string;
    symbol: string;
    primaryTimeframe: string;
    timeframeSelectionSource: string;
    contextTimeframes: string[];
    bid: number | null;
    ask: number | null;
    mid: number | null;
    spread: number | null;
    quoteAgeMs: number | null;
    serverTimestamp: number;
    sourceHealth: string;
    fingerprint: string;
  };
  candleEnvelopes: MarketSnapshot["envelopes"];
  narrative: MarketNarrative | null;
  structure: {
    trend: string | null;
    swings: unknown;
  } | null;
  liquidity: {
    recentSweepCount: number;
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
    upcomingEvents: Array<{ title: string; time: string; impact: string; currency: string }>;
  };
  chartDrawingsSummary: ReturnType<typeof summarizeChartDrawings>;
  visionImages: VisionImageMeta[];
  userMessage: string;
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
}): NeutralMarketEvidence {
  return {
    scalpingContext: SCALPING_CONTEXT,
    snapshot: {
      snapshotId: input.snapshot.snapshotId,
      symbol: input.snapshot.symbol,
      primaryTimeframe: input.snapshot.primaryTimeframe,
      timeframeSelectionSource: input.snapshot.scope.selectionSource,
      contextTimeframes: input.snapshot.scope.contextTimeframes,
      bid: input.snapshot.bid,
      ask: input.snapshot.ask,
      mid: input.snapshot.mid,
      spread: input.snapshot.spread,
      quoteAgeMs: input.snapshot.quoteAgeMs,
      serverTimestamp: input.snapshot.serverTimestamp,
      sourceHealth: input.snapshot.sourceHealth,
      fingerprint: input.snapshot.fingerprint,
    },
    candleEnvelopes: input.snapshot.envelopes,
    narrative: input.narrative,
    structure: input.structure
      ? {
          trend: input.structure.trend,
          swings: {
            count: input.structure.swings?.length ?? 0,
            latestEvent: input.structure.latestStructureEvent
              ? {
                  type: input.structure.latestStructureEvent.type,
                  direction: input.structure.latestStructureEvent.direction,
                  brokenLevel: input.structure.latestStructureEvent.brokenLevel,
                }
              : null,
          },
        }
      : null,
    liquidity: input.liquidity
      ? { recentSweepCount: input.liquidity.sweeps?.length ?? 0 }
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
    chartDrawingsSummary: summarizeChartDrawings(
      input.chartDrawings,
      input.market.currentPrice,
    ),
    visionImages: input.visionMetas,
    userMessage: input.userMessage.slice(0, 500),
  };
}

/** Assert no candidate-authority keys leaked into the model payload. */
export function assertNoCandidateAuthority(payload: unknown): string[] {
  const forbidden = [
    "selectedCandidate",
    "selectedTradeCandidateId",
    "tradeCandidates",
    "rejectedCandidateReasons",
    "candidatesResult",
    "playbook",
    "proposedTrade",
  ];
  const text = JSON.stringify(payload);
  return forbidden.filter((key) => {
    // Allow explicit undefined markers like "tradeCandidates":null only if value is null/undefined
    const re = new RegExp(`"${key}"\\s*:\\s*(?!null|undefined)[^\\sn]`);
    return re.test(text) && !new RegExp(`"${key}"\\s*:\\s*null`).test(text);
  });
}
