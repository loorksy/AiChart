import type { AppLocale } from "@/lib/i18n/types";

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

/**
 * The one money format for the top bar and profile. Subscription credit and
 * MT equity used to render with different precision — "$0.00" beside "$0
 * USD" — which reads as one of the two being broken. Both now go through
 * this.
 */
export function formatUsd(value: number, decimals = 2): string {
  return `$${value.toFixed(decimals)}`;
}

/**
 * An integer counter — credits, message counts — in the reader's own digits:
 * Arabic-Indic digits for ar, Latin for en ("1,250"). The explicit
 * region+numbering tags keep every runtime deterministic: a bare "ar" can
 * resolve to Latin digits on one host and Arabic on another.
 */
export function formatInteger(value: number, locale: AppLocale): string {
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat(
    locale === "ar" ? "ar-EG-u-nu-arab" : "en-US",
    { maximumFractionDigits: 0 },
  ).format(value);
}
