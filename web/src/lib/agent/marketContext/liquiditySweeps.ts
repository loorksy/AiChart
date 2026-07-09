/**
 * Liquidity-sweep detection. A sweep is a WICK through a resting-liquidity
 * level (equal highs/lows or a prior swing extreme) with a CLOSE back inside —
 * the opposite of a structure break, which requires a close beyond the level.
 *
 * Pure candle math — deterministic and unit-testable. A sweep alone is never
 * a trade signal; the decision engine requires structure confirmation on top.
 */
import type { AgentCandle, PriceLevel } from "./detectors";
import type { StructureEvent } from "./structureEvents";

export type LiquiditySweep = {
  side: "buy_side" | "sell_side";
  sweptLevel: number;
  candleTime: number;
  wickExtreme: number;
  closeBackInside: boolean;
  strength: number; // 0–100
  followedByStructureShift: boolean;
};

export function detectLiquiditySweeps(input: {
  candles: AgentCandle[];
  equalHighs: PriceLevel[];
  equalLows: PriceLevel[];
  structureEvents?: StructureEvent[];
  atr?: number | null;
}): LiquiditySweep[] {
  const { candles, equalHighs, equalLows } = input;
  if (candles.length < 5) return [];
  const atr = input.atr && input.atr > 0 ? input.atr : approxAtr(candles);
  if (!atr) return [];

  const sweeps: LiquiditySweep[] = [];

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;

    // Buy-side sweep: wick ABOVE a resting buy-side pool, close back below it.
    for (const pool of equalHighs) {
      if (pool.time >= c.time) continue; // pool must pre-exist the sweep
      if (c.high > pool.price && c.close < pool.price) {
        sweeps.push(
          buildSweep({
            side: "buy_side",
            level: pool.price,
            candle: c,
            atr,
            structureEvents: input.structureEvents ?? [],
          }),
        );
        break; // one sweep per candle per side
      }
    }

    // Sell-side sweep: wick BELOW a resting sell-side pool, close back above it.
    for (const pool of equalLows) {
      if (pool.time >= c.time) continue;
      if (c.low < pool.price && c.close > pool.price) {
        sweeps.push(
          buildSweep({
            side: "sell_side",
            level: pool.price,
            candle: c,
            atr,
            structureEvents: input.structureEvents ?? [],
          }),
        );
        break;
      }
    }
  }

  // Deduplicate near-identical sweeps of the same pool, keep the latest 10.
  const seen = new Set<string>();
  const unique = sweeps.filter((s) => {
    const key = `${s.side}:${s.sweptLevel.toFixed(6)}:${s.candleTime}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.slice(-10);
}

export function latestLiquiditySweep(
  sweeps: LiquiditySweep[],
): LiquiditySweep | null {
  return sweeps.at(-1) ?? null;
}

/**
 * Re-evaluate `followedByStructureShift` once structure events are known
 * (liquidity and structure agents run in parallel, so sweeps are detected
 * first without events and enriched afterwards).
 */
export function enrichSweepsWithStructure(
  sweeps: LiquiditySweep[],
  structureEvents: StructureEvent[],
): LiquiditySweep[] {
  if (!structureEvents.length) return sweeps;
  return sweeps.map((s) => {
    const wanted = s.side === "buy_side" ? "bearish" : "bullish";
    const followed = structureEvents.some(
      (ev) =>
        (ev.type === "CHoCH" || ev.type === "MSS") &&
        ev.direction === wanted &&
        ev.breakCandleTime >= s.candleTime,
    );
    if (followed === s.followedByStructureShift) return s;
    return {
      ...s,
      followedByStructureShift: followed,
      strength: Math.max(5, Math.min(100, s.strength + (followed ? 30 : -30))),
    };
  });
}

function buildSweep(input: {
  side: "buy_side" | "sell_side";
  level: number;
  candle: AgentCandle;
  atr: number;
  structureEvents: StructureEvent[];
}): LiquiditySweep {
  const { side, level, candle, atr } = input;
  const wickExtreme = side === "buy_side" ? candle.high : candle.low;
  const penetration = Math.abs(wickExtreme - level);
  const rejection = Math.abs(candle.close - wickExtreme);

  // A sweep is followed by a structure shift when a CHoCH/MSS in the opposite
  // direction of the swept side occurs after the sweep candle.
  const wantedDirection = side === "buy_side" ? "bearish" : "bullish";
  const followedByStructureShift = input.structureEvents.some(
    (ev) =>
      (ev.type === "CHoCH" || ev.type === "MSS") &&
      ev.direction === wantedDirection &&
      ev.breakCandleTime >= candle.time,
  );

  let strength = 0;
  strength += Math.min(35, Math.round((penetration / atr) * 35));
  strength += Math.min(35, Math.round((rejection / atr) * 25));
  if (followedByStructureShift) strength += 30;
  strength = Math.max(5, Math.min(100, strength));

  return {
    side,
    sweptLevel: level,
    candleTime: candle.time,
    wickExtreme,
    closeBackInside: true,
    strength,
    followedByStructureShift,
  };
}

function approxAtr(candles: AgentCandle[]): number | null {
  const window = candles.slice(-14);
  const trs = window.map((c) => c.high - c.low).filter((x) => x > 0);
  if (!trs.length) return null;
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}
