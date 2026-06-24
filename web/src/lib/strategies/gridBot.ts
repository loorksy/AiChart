/**
 * Grid / Martingale strategy — PURE decision engine (no I/O).
 *
 * Mirrors the classic MQL5 GridBot idea (open in one direction, add a
 * multiplied lot each adverse grid step, close the whole basket at a shared
 * break-even + target) but adds the production guardrails the naive EA lacks:
 *   - hard cap on grid depth (maxLevels) — a runaway Martingale is the #1 way
 *     these blow an account,
 *   - cap on total exposure (maxTotalLot),
 *   - basket take-profit computed from the weighted break-even (closes all at a
 *     small aggregate profit), evaluated server-side so we never depend on
 *     per-position TP modification at the broker.
 *
 * Keeping this pure makes the risky money logic fully unit-testable and
 * deterministic; all broker/DB effects live in botEngine.ts.
 */

export type GridSide = "buy" | "sell";

export interface GridConfig {
  side: GridSide;
  /** Lot of the first order. */
  initialLot: number;
  /** Adverse distance (in price units) between grid levels. */
  gridStep: number;
  /** Lot multiplier per added level (Martingale). 1 = flat grid. */
  multiplier: number;
  /** Basket profit target distance (in price units) from break-even. */
  takeProfit: number;
  /** Hard cap on number of open grid levels (safety). */
  maxLevels: number;
  /** Hard cap on summed lots across the basket (safety). */
  maxTotalLot: number;
  /** Optional per-lot rounding step (e.g. 0.01). */
  lotStep?: number;
}

export interface GridLevel {
  price: number;
  lot: number;
  /** MT5 ticket (live). */
  ticket?: number;
  /** AiChart trades.id (live). */
  tradeId?: number;
}

export interface GridQuote {
  bid: number;
  ask: number;
}

export type GridAction = "open" | "close_all" | "hold";

export interface GridDecision {
  action: GridAction;
  side?: GridSide;
  lot?: number;
  /** Machine-readable reason for audit/metrics. */
  reason:
    | "first_order"
    | "grid_add"
    | "take_profit"
    | "max_levels_reached"
    | "max_total_lot"
    | "waiting";
  /** Diagnostics surfaced to logs/UI. */
  breakEven?: number;
  totalLot?: number;
}

const EPS = 1e-9;

function roundLot(lot: number, step?: number): number {
  if (!step || step <= 0) return lot;
  return Math.max(step, Math.round(lot / step) * step);
}

/** Weighted-average entry price across the open basket (the break-even). */
export function breakEven(levels: GridLevel[]): number {
  const totalLot = levels.reduce((s, l) => s + l.lot, 0);
  if (totalLot <= 0) return 0;
  return levels.reduce((s, l) => s + l.price * l.lot, 0) / totalLot;
}

export function totalLot(levels: GridLevel[]): number {
  return levels.reduce((s, l) => s + l.lot, 0);
}

/**
 * Aggregate unrealized profit of the basket in PRICE units × lots (a proxy for
 * money that is monotonic in the real PnL). For a SELL basket profit rises as
 * price falls; for BUY as price rises.
 */
export function basketProfitDistance(
  side: GridSide,
  levels: GridLevel[],
  quote: GridQuote,
): number {
  const be = breakEven(levels);
  if (be <= 0) return 0;
  // Close price for a sell basket is the ask (you buy back); for buy it's bid.
  const close = side === "sell" ? quote.ask : quote.bid;
  return side === "sell" ? be - close : close - be;
}

/**
 * Decide the single action for this tick. At most one order per tick (matches
 * the EA cadence and avoids fan-out). Order of checks: take-profit first (always
 * prefer banking the basket), then a guarded grid addition, else hold.
 */
export function evaluateGrid(
  config: GridConfig,
  levels: GridLevel[],
  quote: GridQuote,
): GridDecision {
  const side = config.side;

  // 1) No basket yet → seed the first order.
  if (levels.length === 0) {
    return {
      action: "open",
      side,
      lot: roundLot(config.initialLot, config.lotStep),
      reason: "first_order",
    };
  }

  const be = breakEven(levels);
  const tl = totalLot(levels);

  // 2) Basket take-profit: close everything once aggregate profit ≥ target.
  const profitDist = basketProfitDistance(side, levels, quote);
  if (profitDist >= config.takeProfit - EPS) {
    return { action: "close_all", reason: "take_profit", breakEven: be, totalLot: tl };
  }

  // 3) Adverse move beyond the grid step → consider adding a multiplied level.
  //    Adverse = price moved against the basket direction since the last level.
  const lastPrice = levels[levels.length - 1]!.price;
  const adverse =
    side === "sell" ? quote.bid - lastPrice : lastPrice - quote.ask;

  if (adverse >= config.gridStep - EPS) {
    if (levels.length >= config.maxLevels) {
      return { action: "hold", reason: "max_levels_reached", breakEven: be, totalLot: tl };
    }
    const nextLot = roundLot(
      config.initialLot * Math.pow(config.multiplier, levels.length),
      config.lotStep,
    );
    if (tl + nextLot > config.maxTotalLot + EPS) {
      return { action: "hold", reason: "max_total_lot", breakEven: be, totalLot: tl };
    }
    return { action: "open", side, lot: nextLot, reason: "grid_add", breakEven: be, totalLot: tl };
  }

  return { action: "hold", reason: "waiting", breakEven: be, totalLot: tl };
}
