/**
 * Pair-card arithmetic: the day's move, the price format, and the sparkline
 * geometry. Pure and DOM-free so every card's numbers can be unit-tested —
 * a card that renders a wrong price is worse than a card that renders none.
 */
import { forexBaseQuote } from "@/lib/markets/forexInstruments";

export interface PairQuote {
  symbol: string;
  /**
   * Headline price on the card. Prefer a live mid from the active pipe; fall
   * back to the last close of the sparkline window when the tick is unavailable.
   */
  price: number | null;
  /** Percent move across the window, not since some other session's open. */
  changePct: number | null;
  /** Closes, oldest first — the sparkline's whole input. */
  series: number[];
  /** True when `price` came from a live bid/ask, not the last hourly close. */
  live?: boolean;
}

/**
 * Percent move across a series. Null — never zero — when there is nothing to
 * compare: a flat card and an unknown card must not look alike.
 */
export function changePct(series: number[]): number | null {
  const clean = series.filter((n) => Number.isFinite(n));
  if (clean.length < 2) return null;
  const first = clean[0];
  const last = clean[clean.length - 1];
  if (!first) return null;
  return ((last - first) / first) * 100;
}

/**
 * Decimals a pair is quoted in. Yen crosses move in 1/1000, metals in cents,
 * everything else in pips-with-a-fraction — showing five decimals on gold
 * would be as wrong as showing two on EURUSD.
 */
export function pricePrecision(symbol: string): number {
  const { base, quote } = forexBaseQuote(symbol);
  if (base.startsWith("X") && base.length === 3) return 2;
  if (quote === "JPY") return 3;
  if (!quote) return 2;
  return 5;
}

/** Formatted price for display. Always Latin digits — prices are read LTR. */
export function formatPairPrice(symbol: string, price: number | null): string {
  if (price == null || !Number.isFinite(price)) return "—";
  return price.toFixed(pricePrecision(symbol));
}

/** Signed percent, one decimal, with an explicit + so a gain reads as a gain. */
export function formatChangePct(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const rounded = pct.toFixed(2);
  return Number(rounded) > 0 ? `+${rounded}%` : `${rounded}%`;
}

/**
 * Thin a series down to at most `max` points, keeping the first and last —
 * the endpoints are the ones the percentage is computed from, so they can
 * never be the samples that get dropped.
 */
export function downsample(series: number[], max: number): number[] {
  const clean = series.filter((n) => Number.isFinite(n));
  if (max < 2 || clean.length <= max) return clean;
  const step = (clean.length - 1) / (max - 1);
  const out: number[] = [];
  for (let i = 0; i < max; i += 1) {
    out.push(clean[Math.round(i * step)]);
  }
  return out;
}

export interface SparklineGeometry {
  line: string;
  area: string;
}

/**
 * SVG paths for a sparkline drawn in a `width × height` box. `pad` keeps the
 * stroke off the edges so the extremes are not clipped by the viewBox.
 */
export function sparklineGeometry(
  series: number[],
  width: number,
  height: number,
  pad = 2,
): SparklineGeometry | null {
  const points = series.filter((n) => Number.isFinite(n));
  if (points.length < 2 || width <= 0 || height <= 0) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;
  const usable = Math.max(height - pad * 2, 1);
  const y = (value: number) =>
    // A flat series has no range to scale into; draw it down the middle.
    span === 0 ? height / 2 : pad + (1 - (value - min) / span) * usable;
  const x = (index: number) => (index / (points.length - 1)) * width;

  const line = points
    .map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(value).toFixed(2)}`)
    .join(" ");
  const area = `${line} L${width.toFixed(2)},${height.toFixed(2)} L0,${height.toFixed(2)} Z`;
  return { line, area };
}
