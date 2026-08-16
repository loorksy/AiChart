/**
 * The platform's ONE instrument.
 *
 * Lonora analyses and recommends gold, and nothing else. This module is the
 * single source of truth for that fact: every symbol literal in the codebase
 * either lives here or is a bug (enforced by the gold-only guard test).
 *
 * There is deliberately no "execution symbol" here. The platform never places
 * an order, so no broker spelling of gold exists to resolve.
 * `DATA_SYMBOL` is the canonical key used everywhere in
 * the app; `OANDA_INSTRUMENT` is the only foreign spelling, used at the one
 * boundary that talks to OANDA.
 */

/** Canonical in-app symbol. Every internal surface uses this spelling. */
export const DATA_SYMBOL = "XAUUSD" as const;

/** OANDA v20's spelling of the same instrument — used only in lib/markets/oanda.ts. */
export const OANDA_INSTRUMENT = "XAU_USD" as const;

/** Display name (Arabic-first, matching the product's default locale). */
export const DISPLAY_NAME_AR = "الذهب";
export const DISPLAY_NAME_EN = "Gold";

export const BASE_CURRENCY = "XAU" as const;
export const QUOTE_CURRENCY = "USD" as const;

/**
 * Price geometry.
 *
 * Gold quotes to 2 decimals and the platform's pip convention for XAU is 0.01
 * (consistent with `pipSizeForSymbol` in lib/spread.ts, which this must not
 * contradict). `POINT_SIZE` is the smallest price increment; for gold they are
 * the same number, kept as separate names because they are different concepts
 * and diverge on other instruments — which this platform no longer has.
 */
export const PRICE_DECIMALS = 2;
export const PIP_SIZE = 0.01;
export const POINT_SIZE = 0.01;

/**
 * Contract size for the educational position-size math in G6 (troy ounces per
 * standard lot — the retail convention). Nothing here sizes a real order:
 * there is no account and no broker. It exists so "1% of $10,000 = X lots"
 * can be shown as worked arithmetic rather than an unexplained number.
 */
export const CONTRACT_SIZE_OZ = 100;

/**
 * Trading-calendar reference. Gold follows the metals session: it opens an
 * hour after FX on Sunday and takes a daily maintenance break. The actual
 * calendar logic lives in lib/markets/tradingCalendar.ts (which already
 * classifies XAU as "metal"); this constant names which class to ask for so
 * callers don't re-derive it from the symbol string.
 */
export const TRADING_CLASS = "metal" as const;

/** The only timeframes this platform analyses. */
export const TIMEFRAMES = ["5m", "15m", "1h", "4h"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export function isTimeframe(value: string): value is Timeframe {
  return (TIMEFRAMES as readonly string[]).includes(value);
}

/**
 * Thrown when server-side code is handed an instrument this platform does not
 * cover. Deliberately loud: a non-gold symbol reaching a data path means a
 * caller believes in a universe that no longer exists, and silently coercing
 * it server-side would hide that. UI code coerces instead (see `coerceToGold`)
 * because a stale bookmark or cached client state is a user-facing non-event.
 */
export class GoldOnlyError extends Error {
  readonly symbol: string;
  constructor(symbol: string) {
    super(`هذه المنصة تحلّل الذهب (XAUUSD) فقط — الرمز "${symbol}" غير مدعوم.`);
    this.name = "GoldOnlyError";
    this.symbol = symbol;
  }
}

/** Normalise any spelling to the canonical key: XAUUSDm, xau_usd, "XAU/USD" → XAUUSD. */
function normalise(symbol: string): string {
  return symbol.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 6);
}

/** True when `symbol` is any spelling of gold. */
export function isGold(symbol: string | null | undefined): boolean {
  if (!symbol) return false;
  return normalise(symbol) === DATA_SYMBOL;
}

/**
 * Server-side guard: return the canonical symbol, or throw. Use at every
 * boundary that accepts a caller-supplied instrument (API routes, MCP tools,
 * agent tool calls).
 */
export function requireGold(symbol: string | null | undefined): typeof DATA_SYMBOL {
  if (!isGold(symbol)) throw new GoldOnlyError(String(symbol ?? ""));
  return DATA_SYMBOL;
}

/**
 * UI-side guard: always returns gold, never throws. Use in components, hooks,
 * and client-side routing where a stale symbol should quietly resolve to the
 * only instrument that exists rather than surfacing an error.
 */
export function coerceToGold(_symbol?: string | null): typeof DATA_SYMBOL {
  return DATA_SYMBOL;
}
