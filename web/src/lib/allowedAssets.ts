import type { MarketType } from "./markets/types";

/** Max symbols scanned per monitor cycle when policy is open. */
export const MONITOR_TOP_SYMBOL_LIMIT = 40;

/** Stored alone in allowed_assets JSON to mean «all pairs». */
export const OPEN_ASSETS_TOKEN = "*";

export interface MarketAssets {
  forex: string[];
  /** Optional scan watchlist; overrides top-volume when set. */
  watchlist?: string[];
}

/**
 * Parses stored `allowed_assets` — structured `{ "forex": [...], "watchlist": [...] }`.
 */
export function parseMarketAssets(raw: string): MarketAssets {
  const out: MarketAssets = { forex: [] };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return out;
    }
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
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

/** Returns the forex list as a JSON-array string. */
export function marketAssetsJson(raw: string): string {
  return JSON.stringify(parseMarketAssets(raw).forex);
}

/** Serializes forex policy back to storage form. */
export function serializeMarketAssets(assets: MarketAssets): string {
  return JSON.stringify({
    forex: assets.forex,
    watchlist: assets.watchlist ?? [],
  });
}

/** Updates the forex list and returns merged structured JSON. */
export function setMarketAssets(raw: string, list: string[]): string {
  const assets = parseMarketAssets(raw);
  assets.forex = list;
  return serializeMarketAssets(assets);
}

/** Updates scan watchlist while preserving forex list. */
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

/** True when the user has not restricted forex pairs (empty list or `["*"]`). */
export function isOpenAssetsPolicy(
  raw: string,
  _market: MarketType = "forex",
): boolean {
  return listIsOpen(parseMarketAssets(raw).forex);
}

/** Explicit whitelist symbols for forex (never includes `*`). */
export function parseAllowedAssets(
  raw: string,
  _market: MarketType = "forex",
): string[] {
  return cleanList(parseMarketAssets(raw).forex);
}

/** Whether a symbol is permitted under the user's forex policy. */
export function isSymbolAllowed(
  raw: string,
  symbol: string,
  _market: MarketType = "forex",
): boolean {
  if (isOpenAssetsPolicy(raw)) return true;
  const allowed = parseAllowedAssets(raw);
  if (allowed.length === 0) return true;
  return allowed.includes(symbol.toUpperCase());
}

/** Legacy alias — returns forex whitelist only. */
export async function resolveAllowedAssets(raw: string): Promise<string[]> {
  return parseAllowedAssets(raw);
}

/** Bounded forex list for monitor. */
export async function resolveMonitorAssets(
  raw: string,
  topLimit = MONITOR_TOP_SYMBOL_LIMIT,
): Promise<string[]> {
  const watchlist = parseWatchlist(raw);
  if (watchlist.length > 0) return watchlist.slice(0, topLimit);
  return parseAllowedAssets(raw).slice(0, topLimit);
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

export function allowedAssetsLabel(
  raw: string,
  _market: MarketType = "forex",
): string {
  if (isOpenAssetsPolicy(raw)) {
    return "كل أزواج الفوركس المتاحة لدى الوسيط";
  }
  const list = parseAllowedAssets(raw);
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
