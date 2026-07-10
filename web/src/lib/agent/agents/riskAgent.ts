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
import type { UserTradingProfile } from "../risk/userTradingProfile";
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
  profile?: UserTradingProfile | null;
  account?: AccountRiskSnapshot | null;
  minRr: number;
  educationalOnly?: boolean;
  chartDrawings?: ChartDrawing[];
}

export interface RiskAgentResult {
  proposedTrade: ProposedTrade;
  validation: TradeValidationResult;
  veto: boolean;
  accountWarnings: string[];
  /** Account-level block (limits exceeded / data unavailable). */
  accountBlocked: boolean;
  // --- Phase-2 trading-brain context ---
  selectedCandidate: TradeCandidate | null;
  candidatesResult: TradeCandidatesResult;
  playbook: TradingPlaybookResult;
  rangePosition: RangePosition | null;
}

/**
 * The disciplined trade gate. Builds evidence-based trade candidates (POI
 * scoring, structure events, sweeps, range position, HTF discipline), runs the
 * deterministic trading playbook, then validates the selected candidate.
 * A rejected setup, a failing checklist, or a breached account limit forces
 * the final decision to WAIT — this can never be overridden downstream.
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
    minRr: input.minRr,
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

  // Deterministic playbook checklist — runs BEFORE any Buy/Sell is allowed.
  const playbook = runTradingPlaybook({
    market,
    structure: input.structure,
    liquidity: input.liquidity ? { ...input.liquidity, sweeps } : null,
    mtf: input.mtf,
    news: input.news,
    rangePosition,
    candidatesResult,
    candidate,
    minRr: input.minRr,
    profile: input.profile,
    account: input.account,
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
    atr: market.atr,
    spread: market.spread,
    hasValidPoi: Boolean(candidate),
    htfConflict: Boolean(input.mtf?.conflict),
    newsRisk: input.news?.newsRisk ?? "unknown",
    dataSufficient: meetsDataQuality(market.dataQuality, "trade"),
    minRr: input.minRr,
    educationalOnly: input.educationalOnly,
    hasReversalEvidence: candidatesResult.hasReversalEvidence,
    poiScore: candidate?.poi.score.score,
    rangePosition: rangePosition?.label ?? "unknown",
    setupType: candidate?.setupType,
    entryDistanceState,
    spreadState,
    marketOpen: market.marketOpen,
  });

  // Account-level gate (separate from single-trade validation).
  const accountWarnings: string[] = [];
  let accountBlocked = false;
  if (proposedTrade.action !== "wait" && input.account) {
    if (!input.account.available) {
      accountBlocked = true;
      accountWarnings.push("بيانات المخاطر للحساب غير متاحة — لا تنفيذ.");
    } else {
      if (
        input.profile?.maxOpenTrades != null &&
        input.profile.maxOpenTrades > 0 &&
        input.account.openTradesCount >= input.profile.maxOpenTrades
      ) {
        accountBlocked = true;
        accountWarnings.push("تم بلوغ الحد الأقصى للصفقات المفتوحة.");
      }
      if (
        input.profile?.maxDailyLossPct != null &&
        input.profile.maxDailyLossPct > 0 &&
        input.account.todayRealizedPnlPct <= -Math.abs(input.profile.maxDailyLossPct)
      ) {
        accountBlocked = true;
        accountWarnings.push("تم بلوغ حد الخسارة اليومي.");
      }
      if (input.account.openTradesOnSymbol > 0) {
        accountWarnings.push("توجد صفقة مفتوحة على نفس الرمز — انتبه للتعرّض المزدوج.");
      }
    }
  }

  const veto =
    !validation.accepted ||
    accountBlocked ||
    (proposedTrade.action !== "wait" && !playbook.canTrade);

  // If the playbook blocked a proposed trade, surface its reasons.
  if (proposedTrade.action !== "wait" && !playbook.canTrade) {
    for (const r of playbook.blockingReasons) {
      if (!validation.reasons.includes(r)) validation.reasons.push(r);
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
    status: veto ? "warning" : "completed",
    message: veto
      ? "قائمة الفحص أو المخاطرة رفضت الإعداد — القرار انتظار."
      : `اجتاز الإعداد قائمة الفحص (${playbook.checklist.filter((i) => i.status === "pass").length}/${playbook.checklist.length}).`,
    metadata: {
      accepted: validation.accepted,
      rr: validation.rr,
      accountBlocked,
      canTrade: playbook.canTrade,
      candidates: candidatesResult.candidates.length,
    },
  });

  return {
    proposedTrade,
    validation,
    veto,
    accountWarnings,
    accountBlocked,
    selectedCandidate: candidate,
    candidatesResult,
    playbook,
    rangePosition,
  };
}
