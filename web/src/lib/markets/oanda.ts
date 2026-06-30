/**
 * OANDA v20 market-data adapter (practice/demo by default).
 *
 * Owner decision (supersedes the earlier "EA-only data" rule): forex MARKET
 * DATA — candles, prices, instrument universe — is sourced from OANDA. Execution
 * still happens on the user's own broker via EA/MT5. OANDA demo data is REAL
 * market data, so the "no synthetic data" rule still holds.
 *
 * Activated only when OANDA_API_TOKEN is configured; otherwise callers fall back
 * to the EA path, so this is safe to ship dark.
 */
import { fetchWithTimeout, httpTimeoutMs } from "@/lib/externalFetch";
import { getPlatformValue } from "@/lib/platformConfig";

export interface OandaCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

function token(): string | undefined {
  return getPlatformValue("OANDA_API_TOKEN") || process.env.OANDA_API_TOKEN || undefined;
}

export function oandaAccountId(): string | undefined {
  return getPlatformValue("OANDA_ACCOUNT_ID") || process.env.OANDA_ACCOUNT_ID || undefined;
}

/** practice (default) → fxpractice host; live → fxtrade host. */
export function oandaBaseUrl(): string {
  const env = (getPlatformValue("OANDA_ENV") || process.env.OANDA_ENV || "practice").toLowerCase();
  return env === "live"
    ? "https://api-fxtrade.oanda.com"
    : "https://api-fxpractice.oanda.com";
}

/** True when an OANDA token is configured (data source active). */
export function oandaConfigured(): boolean {
  return Boolean(token());
}

/** AiChart symbol → OANDA instrument: EURUSD→EUR_USD, XAUUSD→XAU_USD, EUR_USD→EUR_USD. */
export function toOandaInstrument(symbol: string): string | null {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (symbol.includes("_") && /^[A-Z]{3}_[A-Z]{3}$/.test(symbol.toUpperCase())) {
    return symbol.toUpperCase();
  }
  if (/^[A-Z]{6}$/.test(s)) return `${s.slice(0, 3)}_${s.slice(3)}`;
  return null;
}

/** OANDA instrument → AiChart symbol: EUR_USD → EURUSD. */
export function fromOandaInstrument(instrument: string): string {
  return instrument.replace("_", "").toUpperCase();
}

const GRANULARITY: Record<string, string> = {
  "1m": "M1",
  "5m": "M5",
  "15m": "M15",
  "30m": "M30",
  "1h": "H1",
  "2h": "H2",
  "4h": "H4",
  "6h": "H6",
  "8h": "H8",
  "12h": "H12",
  "1d": "D",
  "1w": "W",
  "1M": "M",
};

/** Map an AiChart interval to a native OANDA granularity (null when unsupported). */
export function toOandaGranularity(interval: string): string | null {
  return GRANULARITY[interval] ?? null;
}

function authHeaders(): Record<string, string> {
  return { authorization: `Bearer ${token() ?? ""}`, "content-type": "application/json" };
}

interface OandaCandleRow {
  time: string;
  volume?: number;
  complete?: boolean;
  mid?: { o: string; h: string; l: string; c: string };
}

/**
 * Live + historical candles for a forex/metal instrument from OANDA. Returns []
 * when OANDA is not configured, the symbol/interval can't be mapped, or the call
 * fails — so callers cleanly fall back to the EA path.
 */
export async function fetchOandaCandles(
  symbol: string,
  interval: string,
  count: number,
): Promise<OandaCandle[]> {
  if (!oandaConfigured()) return [];
  const instrument = toOandaInstrument(symbol);
  const granularity = toOandaGranularity(interval);
  if (!instrument || !granularity) return [];

  const n = Math.min(Math.max(1, count), 5000);
  const url = `${oandaBaseUrl()}/v3/instruments/${instrument}/candles?granularity=${granularity}&count=${n}&price=M`;

  const res = await fetchWithTimeout(
    url,
    { headers: authHeaders(), cache: "no-store" },
    { timeoutMs: httpTimeoutMs(), label: "OANDA candles" },
  );
  if (!res.ok) {
    throw new Error(`OANDA candles HTTP ${res.status}`);
  }
  const data = (await res.json()) as { candles?: OandaCandleRow[] };
  const rows = data.candles ?? [];
  const out: OandaCandle[] = [];
  for (const r of rows) {
    // Keep the still-forming last bar — the live chart needs the current candle.
    if (!r.mid) continue;
    const t = Date.parse(r.time);
    const open = Number(r.mid.o);
    const high = Number(r.mid.h);
    const low = Number(r.mid.l);
    const close = Number(r.mid.c);
    if (!Number.isFinite(t) || ![open, high, low, close].every(Number.isFinite)) continue;
    out.push({ time: t, open, high, low, close, volume: r.volume });
  }
  return out;
}
