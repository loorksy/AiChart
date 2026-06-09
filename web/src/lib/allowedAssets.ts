import {
  getBinanceUsdtSpotSymbols,
  getTopUsdtSpotSymbolsByVolume,
} from "./binanceSymbols";

/** Max symbols scanned per monitor cycle when policy is open. */
export const MONITOR_TOP_SYMBOL_LIMIT = 40;

/** Stored alone in allowed_assets JSON to mean «all USDT spot pairs». */
export const OPEN_ASSETS_TOKEN = "*";

/** True when the user has not restricted pairs (empty list or `["*"]`). */
export function isOpenAssetsPolicy(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return true;
    if (parsed.length === 1 && String(parsed[0]).trim() === OPEN_ASSETS_TOKEN) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

/** Explicit whitelist symbols (never includes `*`). */
export function parseAllowedAssets(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((s) => String(s).toUpperCase().trim())
      .filter((s) => s && s !== OPEN_ASSETS_TOKEN);
  } catch {
    return [];
  }
}

/** Resolves the effective symbol list (Binance live list when policy is open). */
export async function resolveAllowedAssets(raw: string): Promise<string[]> {
  if (isOpenAssetsPolicy(raw)) return getBinanceUsdtSpotSymbols();
  return parseAllowedAssets(raw);
}

/** Bounded list for 24/7 monitor — top volume when policy is open. */
export async function resolveMonitorAssets(
  raw: string,
  topLimit = MONITOR_TOP_SYMBOL_LIMIT,
): Promise<string[]> {
  if (isOpenAssetsPolicy(raw)) return getTopUsdtSpotSymbolsByVolume(topLimit);
  return parseAllowedAssets(raw);
}

export function allowedAssetsLabel(raw: string): string {
  if (isOpenAssetsPolicy(raw)) {
    return "جميع أزواج USDT على Binance Spot (تحديث تلقائي)";
  }
  const list = parseAllowedAssets(raw);
  return list.length ? list.join("، ") : "غير محددة";
}

/** Serialize settings value: empty / whitespace → open policy `[]`. */
export function serializeAllowedAssetsInput(raw: string): string {
  const list = raw
    .split(",")
    .map((a) => a.trim().toUpperCase())
    .filter(Boolean);
  return JSON.stringify(list);
}
