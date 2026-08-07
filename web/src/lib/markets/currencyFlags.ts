/**
 * Currency → visual identity for pair cards.
 *
 * A trader reads a pair by its flags before they read its letters, so every
 * card carries the two sovereigns behind the rate. The artwork is vendored
 * under `public/flags` (see the README there); this module owns the mapping
 * and nothing else, so it stays testable without a DOM.
 */
import { forexBaseQuote } from "@/lib/markets/forexInstruments";

/** ISO 4217 → ISO 3166-1 alpha-2, for every currency the platform quotes. */
const CURRENCY_COUNTRY: Record<string, string> = {
  USD: "US",
  EUR: "EU",
  GBP: "GB",
  JPY: "JP",
  CHF: "CH",
  CAD: "CA",
  AUD: "AU",
  NZD: "NZ",
  CNH: "CN",
  CNY: "CN",
  HKD: "HK",
  SGD: "SG",
  SEK: "SE",
  NOK: "NO",
  DKK: "DK",
  PLN: "PL",
  HUF: "HU",
  CZK: "CZ",
  TRY: "TR",
  ZAR: "ZA",
  MXN: "MX",
  THB: "TH",
  INR: "IN",
  SAR: "SA",
  AED: "AE",
  RUB: "RU",
  ILS: "IL",
  KRW: "KR",
  BRL: "BR",
  TWD: "TW",
  PHP: "PH",
  IDR: "ID",
  MYR: "MY",
};

/** Every currency with vendored artwork — the guard a test can iterate. */
export const FLAGGED_CURRENCIES = Object.keys(CURRENCY_COUNTRY);

/** Precious metals trade as currencies but answer to no flag. */
const METALS: Record<string, { tint: string; short: string }> = {
  XAU: { tint: "gold", short: "Au" },
  XAG: { tint: "silver", short: "Ag" },
  XPT: { tint: "platinum", short: "Pt" },
  XPD: { tint: "platinum", short: "Pd" },
};

export type CurrencyMark =
  | { kind: "flag"; code: string; country: string; src: string }
  /** `src` present = real vendored artwork (nvstly/icons); absent = tint disc. */
  | { kind: "metal"; code: string; tint: string; short: string; src?: string }
  | { kind: "unknown"; code: string };

/** Metals with real artwork under /public/pairs (vendored, no CDN). */
const METAL_ARTWORK: Record<string, string> = {
  XAU: "/pairs/XAU.png",
  XAG: "/pairs/XAG.png",
};

/** How a single currency should be drawn. Never throws — unknown is a state. */
export function currencyMark(currency: string): CurrencyMark {
  const code = currency.trim().toUpperCase();
  const metal = METALS[code];
  if (metal) {
    return {
      kind: "metal",
      code,
      tint: metal.tint,
      short: metal.short,
      src: METAL_ARTWORK[code],
    };
  }
  const country = CURRENCY_COUNTRY[code];
  if (country) {
    return {
      kind: "flag",
      code,
      country,
      src: `/flags/${country.toLowerCase()}.svg`,
    };
  }
  return { kind: "unknown", code };
}

/**
 * Both sides of a pair, in quote order. Broker symbols carry suffixes
 * (`EURUSDm`, `XAUUSD.pro`); `forexBaseQuote` already normalizes those, and
 * anything it cannot split falls back to the raw symbol as the base so a card
 * still renders rather than disappearing.
 */
export function pairMarks(symbol: string): { base: CurrencyMark; quote: CurrencyMark | null } {
  const { base, quote } = forexBaseQuote(symbol);
  if (!base) {
    return { base: { kind: "unknown", code: symbol.toUpperCase() }, quote: null };
  }
  return {
    base: currencyMark(base),
    quote: quote ? currencyMark(quote) : null,
  };
}
