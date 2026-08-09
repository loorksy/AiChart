/**
 * Synthetic candle fixtures for replay/evaluation tests. Deterministic
 * generators — no randomness — so tests are reproducible.
 */
import type { AgentCandle } from "../../marketContext/detectors";

const BAR_MS = 60_000;

/** Simple trending series with pullbacks (sawtooth up or down). */
export function trendingCandles(input: {
  count: number;
  start: number;
  stepUp: number;
  stepDown: number;
  direction: "up" | "down";
  t0?: number;
}): AgentCandle[] {
  const out: AgentCandle[] = [];
  let price = input.start;
  const t0 = input.t0 ?? 0;
  for (let i = 0; i < input.count; i++) {
    const legUp = i % 5 !== 4; // 4 bars impulse, 1 bar pullback
    const delta =
      input.direction === "up"
        ? legUp
          ? input.stepUp
          : -input.stepDown
        : legUp
          ? -input.stepUp
          : input.stepDown;
    const open = price;
    const close = price + delta;
    out.push({
      time: t0 + i * BAR_MS,
      open,
      close,
      high: Math.max(open, close) + input.stepUp * 0.2,
      low: Math.min(open, close) - input.stepUp * 0.2,
    });
    price = close;
  }
  return out;
}

/** Flat range oscillating between low and high. */
export function rangingCandles(input: {
  count: number;
  low: number;
  high: number;
  t0?: number;
}): AgentCandle[] {
  const out: AgentCandle[] = [];
  const t0 = input.t0 ?? 0;
  const mid = (input.low + input.high) / 2;
  const amp = (input.high - input.low) / 2;
  for (let i = 0; i < input.count; i++) {
    const phase = Math.sin((i / 10) * Math.PI);
    const close = mid + amp * phase * 0.9;
    const open = mid + amp * Math.sin(((i - 1) / 10) * Math.PI) * 0.9;
    out.push({
      time: t0 + i * BAR_MS,
      open,
      close,
      high: Math.max(open, close) + amp * 0.1,
      low: Math.min(open, close) - amp * 0.1,
    });
  }
  return out;
}
