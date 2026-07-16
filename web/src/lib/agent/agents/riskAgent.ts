import type { AgentRunContext } from "../types";
import type { AgentMarketContext } from "../marketContext/buildAgentMarketContext";
import type { StructureResult } from "./structureAgent";
import type { SupplyDemandResult } from "./supplyDemandAgent";
import type { LiquidityResult } from "./liquidityAgent";
import type { MultiTimeframeResult } from "./multiTimeframeAgent";
import type { NewsMacroResult } from "./newsMacroAgent";
import {
  validateTradeSetup,
  type ProposedTrade,
  type TradeValidationResult,
} from "../risk/validateTradeSetup";
import { isSpreadTooHigh } from "../risk/spreadCheck";
import {
  computeRangePosition,
  type RangePosition,
} from "../marketContext/rangePosition";
import { enrichSweepsWithStructure } from "../marketContext/liquiditySweeps";
import {
  buildTradeCandidates,
  type TradeCandidate,
  type TradeCandidatesResult,
} from "../trading/buildTradeCandidates";
import { chartDrawingZones } from "../trading/chartDrawingZones";
import {
  runTradingPlaybook,
  type TradingPlaybookResult,
} from "../trading/tradingPlaybook";
import { meetsDataQuality } from "../dataQualityPolicy";
import type { ChartDrawing } from "@/lib/chartDrawings";

export interface AccountRiskSnapshot {
  openTradesCount: number;
  openTradesOnSymbol: number;
  todayRealizedPnlPct: number;
  /** null when account data is unavailable — the agent must not execute then. */
  available: boolean;
}

export interface RiskAgentInput {
  market: AgentMarketContext;
  structure: StructureResult | null;
  supplyDemand: SupplyDemandResult | null;
  liquidity: LiquidityResult | null;
  mtf: MultiTimeframeResult | null;
  news: NewsMacroResult | null;
  account?: AccountRiskSnapshot | null;
  educationalOnly?: boolean;
  chartDrawings?: ChartDrawing[];
}

export interface RiskAgentResult {
  proposedTrade: ProposedTrade;
  validation: TradeValidationResult;
  accountWarnings: string[];
  // --- Phase-2 trading-brain context ---
  selectedCandidate: TradeCandidate | null;
  candidatesResult: TradeCandidatesResult;
  playbook: TradingPlaybookResult;
  rangePosition: RangePosition | null;
}

/**
 * Builds structured evidence candidates for the final model. It annotates
 * risk and data concerns but never forces BUY/SELL/WAIT.
 */
export async function runRiskAgent(
  ctx: AgentRunContext,
  input: RiskAgentInput,
): Promise<RiskAgentResult> {
  ctx.emitActivity({
    type: "risk",
    status: "started",
    message: "أشغّل قائمة فحص التداول وأتحقق من صلاحية الإعداد والمخاطرة.",
  });

  const market = input.market;
  const price = market.currentPrice ?? 0;
  const rangePosition = computeRangePosition(market.currentTfCandles, price);

  // Enrich sweeps now that structure events are known (agents ran in parallel).
  const structureEvents = input.structure?.structureEvents ?? [];
  const sweeps = enrichSweepsWithStructure(
    input.liquidity?.sweeps ?? [],
    structureEvents,
  );

  const htfLevels = [
    ...market.majorLevels.support.map((l) => l.price),
    ...market.majorLevels.resistance.map((l) => l.price),
  ];

  const userDrawingZones = chartDrawingZones({
    drawings: input.chartDrawings,
    currentPrice: price,
    atr: market.atr,
    lastCandleTime: market.currentTfCandles.at(-1)?.time,
  });

  const candidatesResult = buildTradeCandidates({
    candles: market.currentTfCandles,
    currentPrice: price,
    atr: market.atr,
    trend: input.structure?.trend ?? "unknown",
    htfBias: input.mtf?.higherBias ?? "unknown",
    htfConflict: Boolean(input.mtf?.conflict),
    zones: [...(input.supplyDemand?.zones ?? []), ...userDrawingZones],
    structureEvents,
    sweeps,
    rangePosition,
    htfLevels,
    newsRisk: input.news?.newsRisk ?? "unknown",
    spread: market.spread,
  });

  const candidate = candidatesResult.best;
  const proposedTrade: ProposedTrade = candidate
    ? {
        action: candidate.action,
        entry: candidate.entry,
        entryType: candidate.entryType,
        stop_loss: candidate.stop_loss,
        targets: candidate.targets,
      }
    : { action: "wait" };

  // Evidence checklist for the final model.
  const playbook = runTradingPlaybook({
    market,
    structure: input.structure,
    liquidity: input.liquidity ? { ...input.liquidity, sweeps } : null,
    mtf: input.mtf,
    news: input.news,
    rangePosition,
    candidatesResult,
    candidate,
    educationalOnly: input.educationalOnly,
  });

  // Entry-distance state for validation.
  const atr = market.atr ?? 0;
  const entryDistanceState = !candidate
    ? "unknown"
    : atr > 0
      ? Math.abs(price - candidate.entry) / atr > 1.5
        ? "missed"
        : Math.abs(price - candidate.entry) / atr > 1
          ? "far"
          : "near"
      : "unknown";

  const spreadState =
    market.spread == null
      ? "unknown"
      : candidate &&
          isSpreadTooHigh({
            spread: market.spread,
            atr,
            stopDistance: Math.abs(candidate.entry - candidate.stop_loss),
          })
        ? "wide"
        : "normal";

  const validation = validateTradeSetup({
    trade: proposedTrade,
    currentPrice: price,
    htfConflict: Boolean(input.mtf?.conflict),
    newsRisk: input.news?.newsRisk ?? "unknown",
    dataSufficient: meetsDataQuality(market.dataQuality, "trade"),
    coverageDetail: market.dataQuality.coverage?.summaryEn,
    poiScore: candidate?.poi.score.score,
    entryDistanceState,
    spreadState,
  });

  // Account-level gate (separate from single-trade validation).
  const accountWarnings: string[] = [];
  if (proposedTrade.action !== "wait" && input.account) {
    if (!input.account.available) {
      accountWarnings.push("بيانات الحساب غير متاحة لحساب الحجم حالياً.");
    } else if (input.account.openTradesOnSymbol > 0) {
      accountWarnings.push("توجد صفقة مفتوحة على الرمز نفسه؛ هذا سياق تعرّض للقرار.");
    }
  }

  // If there is no candidate at all, surface the strongest rejection reasons.
  if (!candidate && candidatesResult.rejectedReasons.length) {
    for (const r of candidatesResult.rejectedReasons.slice(0, 3)) {
      if (!validation.reasons.includes(r)) validation.reasons.push(r);
    }
  }

  ctx.emitActivity({
    type: "risk",
    status: validation.accepted ? "completed" : "warning",
    message: `اكتمل تجهيز أدلة القرار (${candidatesResult.candidates.length} مرشح).`,
    metadata: {
      accepted: validation.accepted,
      rr: validation.rr,
      candidates: candidatesResult.candidates.length,
    },
  });

  return {
    proposedTrade,
    validation,
    accountWarnings,
    selectedCandidate: candidate,
    candidatesResult,
    playbook,
    rangePosition,
  };
}
