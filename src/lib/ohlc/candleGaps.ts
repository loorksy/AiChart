import { barDurationMs } from "@/lib/intervals";
import {
  isExpectedDailyBarOpen,
  isMarketOpenAt,
} from "@/lib/markets/tradingCalendar";
import { normalizeCanonicalInterval } from "@/lib/markets/intervals";

export interface CandleGap {
  fromMs: number;
  toMs: number;
  missingBars: number;
}

/**
 * Detect missing open-market bars in an in-memory candle array, while
 * ignoring the FX weekend, the metals daily maintenance break, and
 * DST-shifted daily alignment.
 *
 * Daily series get their own predicate: forex daily candles open at 17:00
 * America/New_York, so a fixed 24h step drifts by an hour across every DST
 * transition. `isExpectedDailyBarOpen` counts a candidate as missing only when
 * it lands on a genuine session-open slot (Sun–Thu 17:00 NY — five per week).
 */
export function detectCandleGaps(
  symbol: string,
  interval: string,
  candles: readonly { time: number }[],
  maxMissingBars = 20_000,
): CandleGap[] {
  const canonicalInterval = normalizeCanonicalInterval(interval);
  const step = barDurationMs(canonicalInterval);
  if (!(step > 0) || candles.length < 2) return [];
  const isDaily = canonicalInterval === "1d";
  const isExpectedBar = (candidate: number): boolean =>
    isDaily
      ? isExpectedDailyBarOpen(symbol, candidate)
      : isMarketOpenAt(symbol, candidate);
  const times = [...new Set(candles.map((candle) => Math.floor(candle.time)))]
    .sort((a, b) => a - b);
  const gaps: CandleGap[] = [];
  let scanned = 0;

  for (let index = 1; index < times.length && scanned < maxMissingBars; index++) {
    const previous = times[index - 1]!;
    const current = times[index]!;
    if (current - previous <= step * 1.5) continue;

    let gapStart: number | null = null;
    let gapEnd: number | null = null;
    let missingBars = 0;
    for (let candidate = previous + step; candidate < current; candidate += step) {
      scanned += 1;
      if (scanned > maxMissingBars) break;
      if (!isExpectedBar(candidate)) {
        if (gapStart != null && gapEnd != null) {
          gaps.push({ fromMs: gapStart, toMs: gapEnd, missingBars });
          gapStart = gapEnd = null;
          missingBars = 0;
        }
        continue;
      }
      gapStart ??= candidate;
      gapEnd = candidate;
      missingBars += 1;
    }
    if (gapStart != null && gapEnd != null) {
      gaps.push({ fromMs: gapStart, toMs: gapEnd, missingBars });
    }
  }
  return gaps;
}
