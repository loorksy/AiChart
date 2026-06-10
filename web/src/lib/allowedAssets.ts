import {
  getBinanceUsdtSpotSymbols,
  getTopUsdtSpotSymbolsByVolume,
} from "./binanceSymbols";
import type { MarketType } from "./markets/types";

/** Max symbols scanned per monitor cycle when policy is open. */
export const MONITOR_TOP_SYMBOL_LIMIT = 40;

/** Stored alone in allowed_assets JSON to mean «all pairs». */
export const OPEN_ASSETS_TOKEN = "*";

export interface MarketAssets {
  crypto: string[]; // [] or ["*"] => open
  forex: string[]; // [] or ["*"] => open
  /** Optional scan watchlist (crypto symbols); overrides top-volume when set. */
  watchlist?: string[];
}

/**
 * Parses the stored `allowed_assets` value, supporting two formats:
 * - Legacy: a JSON array (treated as the crypto whitelist).
 * - Structured: `{ "crypto": [...], "forex": [...] }`.
 */
export function parseMarketAssets(raw: string): MarketAssets {
  const out: MarketAssets = { crypto: [], forex: [] };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      out.crypto = parsed.map((s) => String(s));
      return out;
    }
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.crypto)) out.crypto = obj.crypto.map((s) => String(s));
      if (Array.isArray(obj.forex)) out.forex = obj.forex.map((s) => String(s));
      if (Array.isArray(obj.watchlist)) {
        out.watchlist = obj.watchlist.map((s) => String(s));
      }
    }
  } catch {
    /* fall through to defaults (open) */
  }
  return out;
}

/** Returns the per-market list as a JSON-array string (for legacy helpers). */
export function marketAssetsJson(raw: string, market: MarketType): string {
  const assets = parseMarketAssets(raw);
  return JSON.stringify(market === "forex" ? assets.forex : assets.crypto);
}

/** Serializes a structured per-market policy back to storage form. */
export function serializeMarketAssets(assets: MarketAssets): string {
  return JSON.stringify({
    crypto: assets.crypto,
    forex: assets.forex,
    watchlist: assets.watchlist ?? [],
  });
}

/** Updates one market's list and returns the merged structured JSON. */
export function setMarketAssets(
  raw: string,
  market: MarketType,
  list: string[],
): string {
  const assets = parseMarketAssets(raw);
  if (market === "forex") assets.forex = list;
  else assets.crypto = list;
  return serializeMarketAssets(assets);
}

/** Updates scan watchlist while preserving crypto/forex lists. */
export function setWatchlist(raw: string, list: string[]): string {
  const assets = parseMarketAssets(raw);
  assets.watchlist = list;
  return serializeMarketAssets(assets);
}

function listIsOpen(list: string[]): boolean {
  if (list.length === 0) return true;
  if (list.length === 1 && String(list[0]).trim() === OPEN_ASSETS_TOKEN) {
    return true;
  }
  return false;
}

function cleanList(list: string[]): string[] {
  return list
    .map((s) => String(s).toUpperCase().trim())
    .filter((s) => s && s !== OPEN_ASSETS_TOKEN);
}

/** True when the user has not restricted pairs (empty list or `["*"]`). */
export function isOpenAssetsPolicy(raw: string, market: MarketType = "crypto"): boolean {
  const assets = parseMarketAssets(raw);
  return listIsOpen(market === "forex" ? assets.forex : assets.crypto);
}

/** Explicit whitelist symbols for a market (never includes `*`). */
export function parseAllowedAssets(raw: string, market: MarketType = "crypto"): string[] {
  const assets = parseMarketAssets(raw);
  return cleanList(market === "forex" ? assets.forex : assets.crypto);
}

/** Whether a symbol is permitted under the user's policy for a market. */
export function isSymbolAllowed(
  raw: string,
  symbol: string,
  market: MarketType,
): boolean {
  if (isOpenAssetsPolicy(raw, market)) return true;
  const allowed = parseAllowedAssets(raw, market);
  if (allowed.length === 0) return true;
  return allowed.includes(symbol.toUpperCase());
}

/** Resolves the effective crypto symbol list (Binance live list when open). */
export async function resolveAllowedAssets(raw: string): Promise<string[]> {
  if (isOpenAssetsPolicy(raw, "crypto")) return getBinanceUsdtSpotSymbols();
  return parseAllowedAssets(raw, "crypto");
}

/** Bounded crypto list for 24/7 monitor — top volume when policy is open. */
export async function resolveMonitorAssets(
  raw: string,
  topLimit = MONITOR_TOP_SYMBOL_LIMIT,
): Promise<string[]> {
  const watchlist = parseWatchlist(raw);
  if (watchlist.length > 0) return watchlist.slice(0, topLimit);

  if (isOpenAssetsPolicy(raw, "crypto")) {
    return getTopUsdtSpotSymbolsByVolume(topLimit);
  }
  return parseAllowedAssets(raw, "crypto");
}

/** Explicit watchlist from structured allowed_assets (empty if unset). */
export function parseWatchlist(raw: string): string[] {
  return cleanList(parseMarketAssets(raw).watchlist ?? []);
}

/** Assets for manual / user-triggered scans (watchlist → monitor list). */
export async function resolveScanAssets(
  raw: string,
  topLimit = MONITOR_TOP_SYMBOL_LIMIT,
): Promise<string[]> {
  return resolveMonitorAssets(raw, topLimit);
}

const FOREX_SCAN_FALLBACK = ["EURUSD", "XAUUSD", "GBPUSD"];

/** Scan symbol list for a market (crypto uses watchlist/top volume; forex uses allowed list). */
export async function resolveScanAssetsForMarket(
  raw: string,
  market: MarketType,
  topLimit = MONITOR_TOP_SYMBOL_LIMIT,
): Promise<string[]> {
  if (market === "forex") {
    const watchlist = parseWatchlist(raw);
    if (watchlist.length > 0) {
      return watchlist.slice(0, topLimit);
    }
    if (isOpenAssetsPolicy(raw, "forex")) {
      const allowed = parseAllowedAssets(raw, "forex");
      return allowed.length > 0 ? allowed.slice(0, topLimit) : FOREX_SCAN_FALLBACK;
    }
    return parseAllowedAssets(raw, "forex").slice(0, topLimit);
  }
  return resolveScanAssets(raw, topLimit);
}

export function allowedAssetsLabel(raw: string, market: MarketType = "crypto"): string {
  if (isOpenAssetsPolicy(raw, market)) {
    return market === "forex"
      ? "كل أزواج الفوركس المتاحة لدى الوسيط"
      : "جميع أزواج USDT على Binance Spot (تحديث تلقائي)";
  }
  const list = parseAllowedAssets(raw, market);
  return list.length ? list.join("، ") : "غير محددة";
}

/** Serialize a comma-separated input into a JSON array (empty → open `[]`). */
export function serializeAllowedAssetsInput(raw: string): string {
  const list = raw
    .split(",")
    .map((a) => a.trim().toUpperCase())
    .filter(Boolean);
  return JSON.stringify(list);
}
