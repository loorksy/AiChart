/**
 * Gold grid + martingale decision engine — INDEPENDENT from gridBot.ts.
 * Uses pip-based steps for XAUUSD via pipSizeForSymbol.
 */
import { pipSizeForSymbol } from "@/lib/spread";
import { GOLD_SYMBOL } from "./goldDefaults";
import type {
  GoldBotConfig,
  GoldDecision,
  GoldGridLevel,
  GoldQuote,
  GoldSide,
} from "./goldTypes";

const EPS = 1e-9;

export function pipsToPrice(pips: number, midPrice?: number): number {
  return pips * pipSizeForSymbol(GOLD_SYMBOL, midPrice);
}

function roundLot(lot: number, step?: number, maxCap?: number): number {
  let out = lot;
  if (step && step > 0) {
    out = Math.max(step, Math.round(out / step) * step);
  }
  if (maxCap != null && maxCap > 0) {
    out = Math.min(out, maxCap);
  }
  return out;
}

export function breakEven(levels: GoldGridLevel[]): number {
  const totalLot = levels.reduce((s, l) => s + l.lot, 0);
  if (totalLot <= 0) return 0;
  return levels.reduce((s, l) => s + l.price * l.lot, 0) / totalLot;
}

export function totalLot(levels: GoldGridLevel[]): number {
  return levels.reduce((s, l) => s + l.lot, 0);
}

export function basketProfitDistance(
  side: GoldSide,
  levels: GoldGridLevel[],
  quote: GoldQuote,
): number {
  const be = breakEven(levels);
  if (be <= 0) return 0;
  const close = side === "sell" ? quote.ask : quote.bid;
  return side === "sell" ? be - close : close - be;
}

function effectiveSide(config: GoldBotConfig, entrySide?: GoldSide): GoldSide {
  return entrySide ?? config.side ?? "buy";
}

function priceParams(config: GoldBotConfig, quote: GoldQuote) {
  const mid = (quote.bid + quote.ask) / 2;
  return {
    gridStep: pipsToPrice(config.gridStepPips, mid),
    takeProfit: pipsToPrice(config.takeProfitPips, mid),
  };
}

/**
 * Single-tick gold grid decision (pure, no I/O).
 */
export function evaluateGoldGrid(
  config: GoldBotConfig,
  levels: GoldGridLevel[],
  quote: GoldQuote,
  entrySide?: GoldSide,
): GoldDecision {
  const side = effectiveSide(config, entrySide);
  const { gridStep, takeProfit } = priceParams(config, quote);

  if (levels.length === 0) {
    const lot = roundLot(config.initialLot, config.lotStep, config.maxLotCap);
    return {
      action: "open",
      side,
      lot,
      reason: "first_order",
    };
  }

  const be = breakEven(levels);
  const tl = totalLot(levels);

  const profitDist = basketProfitDistance(side, levels, quote);
  if (profitDist >= takeProfit - EPS) {
    return {
      action: "close_all",
      reason: "take_profit",
      breakEven: be,
      totalLot: tl,
    };
  }

  const lastPrice = levels[levels.length - 1]!.price;
  const adverse =
    side === "sell" ? quote.bid - lastPrice : lastPrice - quote.ask;

  if (adverse >= gridStep - EPS) {
    if (levels.length >= config.maxLevels) {
      return {
        action: "hold",
        reason: "max_levels_reached",
        breakEven: be,
        totalLot: tl,
      };
    }
    const rawNext = config.initialLot * Math.pow(config.multiplier, levels.length);
    const nextLot = roundLot(rawNext, config.lotStep, config.maxLotCap);
    if (nextLot <= 0) {
      return {
        action: "hold",
        reason: "max_lot_cap",
        breakEven: be,
        totalLot: tl,
      };
    }
    if (tl + nextLot > config.maxTotalLot + EPS) {
      return {
        action: "hold",
        reason: "max_total_lot",
        breakEven: be,
        totalLot: tl,
      };
    }
    return {
      action: "open",
      side,
      lot: nextLot,
      reason: "grid_add",
      breakEven: be,
      totalLot: tl,
    };
  }

  return { action: "hold", reason: "waiting", breakEven: be, totalLot: tl };
}
