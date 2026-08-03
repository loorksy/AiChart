export type PriceDirection = "up" | "down" | null;

export interface LivePriceTick {
  price: number;
  changePct: number;
  direction: PriceDirection;
  connected: boolean;
  /**
   * The cost of crossing the book right now, already formatted ("1.4 نقطة").
   * Null until the first tick lands. Which book it is depends on `source` — on
   * a linked cloud account it is the trader's own broker, the spread their
   * order actually pays.
   */
  spreadLabel?: string | null;
  spreadPips?: number | null;
  source?: "oanda" | "metaapi" | "ea" | null;
}

export type LivePriceMap = Record<string, LivePriceTick>;
