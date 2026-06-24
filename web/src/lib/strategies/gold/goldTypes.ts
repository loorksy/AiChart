/**
 * Gold price-action grid bot — types (XAUUSD only, separate from gridBot.ts).
 */

export type GoldSide = "buy" | "sell";

export type CandleTimeframe = "M5" | "M15" | "H1";

export type GoldEntryPattern =
  | "bullish_engulfing"
  | "bearish_engulfing"
  | "hammer"
  | "hanging_man"
  | "shooting_star"
  | "xander_body";

export interface GoldBotConfig {
  /** Locked at entry; optional when auto-detected from candles. */
  side?: GoldSide;
  initialLot: number;
  /** Grid step in pips (converted via pipSizeForSymbol). */
  gridStepPips: number;
  /** Basket TP distance in pips from break-even. */
  takeProfitPips: number;
  multiplier: number;
  maxLevels: number;
  maxTotalLot: number;
  /** Cap per-order lot (Martingale safety). */
  maxLotCap: number;
  candleTimeframe: CandleTimeframe;
  /** Close all + stop when floating loss ≥ this % of startEquity. */
  maxEquityDrawdownPct: number;
  lotStep?: number;
}

export interface GoldGridLevel {
  price: number;
  lot: number;
  ticket?: number;
  tradeId?: number;
}

export interface GoldBotState {
  levels: GoldGridLevel[];
  /** Side locked on first OHLC entry tick. */
  entrySide?: GoldSide;
  detectedPattern?: GoldEntryPattern;
  /** Account equity snapshot at first live/paper open. */
  startEquity?: number;
  lastActionAt?: string;
}

export interface GoldQuote {
  bid: number;
  ask: number;
}

export type GoldAction = "open" | "close_all" | "hold";

export interface GoldDecision {
  action: GoldAction;
  side?: GoldSide;
  lot?: number;
  reason:
    | "first_order"
    | "grid_add"
    | "take_profit"
    | "max_levels_reached"
    | "max_total_lot"
    | "max_lot_cap"
    | "waiting";
  breakEven?: number;
  totalLot?: number;
}

export interface GoldEntrySignal {
  side: GoldSide;
  pattern: GoldEntryPattern;
}
