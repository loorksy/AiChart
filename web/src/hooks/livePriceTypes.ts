export type PriceDirection = "up" | "down" | null;

export interface LivePriceTick {
  price: number;
  changePct: number;
  direction: PriceDirection;
  connected: boolean;
}

export type LivePriceMap = Record<string, LivePriceTick>;
