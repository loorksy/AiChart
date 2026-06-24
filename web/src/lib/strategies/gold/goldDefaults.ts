/**
 * Default configuration tuned for XAUUSD grid + martingale (M15, ~$2 step).
 */
import type { GoldBotConfig } from "./goldTypes";

export const GOLD_SYMBOL = "XAUUSD";

/** Server-side defaults for new gold bots (UI may override). */
export const DEFAULT_GOLD_CONFIG: GoldBotConfig = {
  initialLot: 0.01,
  gridStepPips: 200,
  takeProfitPips: 100,
  multiplier: 2,
  maxLevels: 5,
  maxTotalLot: 0.5,
  maxLotCap: 0.04,
  candleTimeframe: "M15",
  maxEquityDrawdownPct: 20,
  lotStep: 0.01,
};
