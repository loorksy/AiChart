/**
 * Gold Agent X Ultimate — defaults for XAUUSD local intelligence engine.
 */
import type { GoldAgentXConfig } from "./goldTypes";

export const GOLD_SYMBOL = "XAUUSD";

export const DEFAULT_GOLD_AGENTX_CONFIG: GoldAgentXConfig = {
  initialLot: 0.01,
  baseLot: 0.01,
  maxLot: 0.1,
  lotStep: 0.01,
  minConfidence: 60,
  maxEquityDrawdownPct: 20,
  drawdownTightenPct: 15,
  survivalDrawdownPct: 20,
  stopLossAtrMult: 2,
  stopLossPips: 200,
  entryTimeframe: "M15",
  correlationSymbols: {
    dxy: ["DXY", "USDX", "DX", "DXY.m", "USDX.m"],
    us10y: ["US10Y", "UST10Y", "US10Y.m"],
    vix: ["VIX", "VIX.m"],
  },
  optimizerTradeInterval: 75,
  optimizerIntervalTrades: 75,
  institutionalWeights: {
    structure: 0.15,
    momentum: 0.12,
    liquidity: 0.12,
    session: 0.1,
    correlation: 0.1,
    volatility: 0.1,
    memory: 0.08,
    consensus: 0.23,
  },
};

/** @deprecated use DEFAULT_GOLD_AGENTX_CONFIG */
export const DEFAULT_GOLD_CONFIG = {
  initialLot: DEFAULT_GOLD_AGENTX_CONFIG.baseLot,
  maxEquityDrawdownPct: DEFAULT_GOLD_AGENTX_CONFIG.maxEquityDrawdownPct,
};
