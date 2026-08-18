export type PriceDirection = "up" | "down" | null;

export interface LivePriceTick {
  price: number;
  changePct: number;
  direction: PriceDirection;
  connected: boolean;
  /** Raw book for chart price lines (library horizontal lines). */
  bid?: number | null;
  ask?: number | null;
  /**
   * The cost of crossing the book right now, already formatted ("1.4 نقطة").
   * Null until the first tick lands. The book is the platform OANDA feed.
   */
  spreadLabel?: string | null;
  spreadPips?: number | null;
  source?: "oanda" | null;
}

export type LivePriceMap = Record<string, LivePriceTick>;
