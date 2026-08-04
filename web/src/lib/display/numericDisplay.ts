/**
 * Three-state contract for money and other numeric UI:
 * - known finite number (including 0) → formatted value
 * - unknown / not yet loaded → loading
 * - fetch failed → error (never blank, never silent 0)
 */
export type NumericFetchState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; value: number };

/** True when the API returned a finite number (0 is valid). */
export function isNumericReady(
  value: unknown,
): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function numericFromOptional(value: number | null | undefined): NumericFetchState {
  if (value == null || !Number.isFinite(value)) {
    return { status: "loading" };
  }
  return { status: "ready", value };
}

export function formatUsd(value: number, decimals = 2): string {
  return `$${value.toFixed(decimals)}`;
}

export function formatUsdWhole(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}
