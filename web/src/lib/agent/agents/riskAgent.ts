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
import type { UserTradingProfile } from "../risk/userTradingProfile";

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
}

export interface RiskAgentResult {
  proposedTrade: ProposedTrade;
  validation: TradeValidationResult;
  veto: boolean;
  accountWarnings: string[];
  /** Account-level block (limits exceeded / data unavailable). */
  accountBlocked: boolean;
}

/**
 * Proposes a POI-based trade candidate (never entry = current price blindly)
 * from structure + supply/demand, validates the setup, and layers account-level
 * risk. A rejected setup or a breached account limit forces the final WAIT.
 */
export async function runRiskAgent(
  ctx: AgentRunContext,
  input: RiskAgentInput,
): Promise<RiskAgentResult> {
  ctx.emitActivity({
    type: "risk",
    status: "started",
    message: "أتحقق من صلاحية الصفقة والمخاطرة.",
  });

  const proposedTrade = proposeTradeCandidate(input);

  const validation = validateTradeSetup({
    trade: proposedTrade,
    currentPrice: input.market.currentPrice ?? 0,
    atr: input.market.atr,
    spread: input.market.spread,
    // A valid POI is a supply/demand zone OR a nearby resting-liquidity pool.
    hasValidPoi: Boolean(
      input.supplyDemand?.nearestDemand ||
        input.supplyDemand?.nearestSupply ||
        input.liquidity?.nearestBuySide ||
        input.liquidity?.nearestSellSide,
    ),
    htfConflict: Boolean(input.mtf?.conflict),
    newsRisk: input.news?.newsRisk ?? "unknown",
    dataSufficient: input.market.dataQuality.sufficient,
    minRr: input.minRr,
    educationalOnly: input.educationalOnly,
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

  const veto = !validation.accepted || accountBlocked;

  ctx.emitActivity({
    type: "risk",
    status: veto ? "warning" : "completed",
    message: veto
      ? "رفضت الصفقة أو خفّضتها بسبب شروط المخاطرة."
      : "قبلت المخاطرة مبدئياً.",
    metadata: {
      accepted: validation.accepted,
      rr: validation.rr,
      accountBlocked,
    },
  });

  return {
    proposedTrade,
    validation,
    veto,
    accountWarnings,
    accountBlocked,
  };
}

/**
 * POI-based candidate. Buys are anchored to the nearest demand zone, sells to
 * the nearest supply zone; entry = the zone edge (retest), NOT the current
 * close. No zone in the trend direction → WAIT.
 */
function proposeTradeCandidate(input: RiskAgentInput): ProposedTrade {
  const price = input.market.currentPrice;
  if (!price || !input.structure || !input.supplyDemand) {
    return { action: "wait" };
  }

  const trend = input.structure.trend;
  const demand = input.supplyDemand.nearestDemand;
  const supply = input.supplyDemand.nearestSupply;

  if (trend === "uptrend" && demand) {
    const entry = demand.high;
    const stop = demand.low;
    const risk = Math.abs(entry - stop);
    if (risk <= 0) return { action: "wait" };
    return {
      action: "buy",
      entry,
      stop_loss: stop,
      targets: [entry + risk * Math.max(input.minRr, 2)],
    };
  }

  if (trend === "downtrend" && supply) {
    const entry = supply.low;
    const stop = supply.high;
    const risk = Math.abs(stop - entry);
    if (risk <= 0) return { action: "wait" };
    return {
      action: "sell",
      entry,
      stop_loss: stop,
      targets: [entry - risk * Math.max(input.minRr, 2)],
    };
  }

  // Range or conflict → prefer WAIT (no chasing).
  return { action: "wait" };
}
