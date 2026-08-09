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
   * Null until the first tick lands. The book is the trader's own linked
   * broker account — the spread their order actually pays.
   */
  spreadLabel?: string | null;
  spreadPips?: number | null;
  source?: "metaapi" | null;
}

export type LivePriceMap = Record<string, LivePriceTick>;
