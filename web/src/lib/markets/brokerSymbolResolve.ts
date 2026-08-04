/**
 * Match a canonical pair to a broker's own spelling.
 *
 * Brokers invent suffixes freely (XAUUSDm, XAUUSD.pro, XAUUSD_i, XAUUSDc).
 * There is no suffix list that covers them — the only source of truth is what
 * the account reported via rpc.getSymbols(). Comparison folds both sides
 * (strip non-alphanumerics, uppercase) so XAUUSD matches XAUUSDm; the value
 * sent outbound is always the broker's exact spelling, case included.
 * Uppercasing XAUUSDm once cost a full day of "Symbol XAUUSDM does not exist".
 */
import { forexCanonicalKey } from "./forexCanonical";
import { isBrokerSpelledSymbol, normalizeSymbolCase } from "./symbolCase";
import { normalizeSymbol } from "./symbolMapping";

/** Comparison key only — never send this to MetaApi. */
export function normalizeForCompare(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/**
 * True when `brokerSymbol` is the account's spelling of `canonicalOrRaw`.
 * Uses the shared fold for equality; also accepts a canonical 6-letter key
 * matching the leading alnum of a suffixed broker ticker via forexCanonicalKey.
 */
export function brokerSymbolMatches(
  canonicalOrRaw: string,
  brokerSymbol: string,
): boolean {
  const left = normalizeForCompare(canonicalOrRaw);
  const right = normalizeForCompare(brokerSymbol);
  if (left === right) return true;
  // XAUUSD vs XAUUSDm: fold equality fails (XAUUSD ≠ XAUUSDM), but both share
  // the same platform canonical key. That is matching, not inventing a suffix.
  return forexCanonicalKey(canonicalOrRaw) === forexCanonicalKey(brokerSymbol);
}

export type BrokerSymbolCatalogueEntry = {
  broker_symbol: string;
  canonical: string;
};

/**
 * Pick the broker spelling for outbound MetaApi calls from a catalogue built
 * from getSymbols(). Never synthesises a suffix.
 */
export function pickBrokerSymbol(
  canonicalOrRaw: string,
  catalogue: readonly BrokerSymbolCatalogueEntry[],
): string | null {
  const needle = canonicalOrRaw.trim();
  if (!needle) return null;

  // Exact (case-sensitive) hit first — the caller already has the broker form.
  const exact = catalogue.find((row) => row.broker_symbol === needle);
  if (exact) return exact.broker_symbol;

  const hit = catalogue.find((row) =>
    brokerSymbolMatches(needle, row.broker_symbol),
  );
  return hit?.broker_symbol ?? null;
}

/**
 * Resolve what to send to a broker feed. Pure over an injected catalogue so
 * unit tests do not need a DB; the async store wrapper lives beside the
 * catalogue module.
 */
export function resolveBrokerSymbolFromCatalogue(
  canonicalOrRaw: string,
  catalogue: readonly BrokerSymbolCatalogueEntry[],
): string {
  const picked = pickBrokerSymbol(canonicalOrRaw, catalogue);
  if (picked) return picked;

  const mapping = normalizeSymbol(canonicalOrRaw);
  if (mapping.mt5 && mapping.mt5 !== mapping.canonical) {
    // Env override MT5_{CANONICAL}_SYMBOL — the only static fallback, and it
    // is an operator-supplied exact spelling, not a guessed suffix.
    return mapping.mt5;
  }

  // Already broker-spelled input (lowercase suffix) must pass through untouched.
  if (isBrokerSpelledSymbol(canonicalOrRaw)) {
    return normalizeSymbolCase(canonicalOrRaw.trim());
  }

  // Last resort: the raw/canonical form. MetaApi may still reject it; callers
  // that have a live catalogue should have hit pickBrokerSymbol above.
  return canonicalOrRaw.trim();
}
