import { barDurationMs, normalizeInterval } from "@/lib/intervals";

/**
 * Whether a candle is closed — pure arithmetic, source-agnostic: a bar whose
 * window has fully elapsed is closed; only the newest bar can still be
 * forming.
 */
export function isCandleComplete(
  openTimeMs: number,
  interval: string,
  nowMs = Date.now(),
): boolean {
  return openTimeMs + barDurationMs(normalizeInterval(interval)) <= nowMs;
}
