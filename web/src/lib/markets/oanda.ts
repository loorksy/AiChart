/**
 * OANDA v20 market-data adapter — the official forex data source for AiChart.
 * Candles, prices, and instrument universe come exclusively from OANDA.
 * Trade execution remains on the user's EA/MT5 broker.
 */
import { fetchWithTimeout, httpTimeoutMs } from "@/lib/externalFetch";
import { barDurationMs } from "@/lib/intervals";
import { getPlatformValue } from "@/lib/platformConfig";

/** How far back the chart may paginate (10 years). */
const HISTORY_LOOKBACK_MS = 10 * 365.25 * 24 * 60 * 60 * 1000;

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
 * Live + historical candles for a forex/metal instrument from OANDA.
 */
export async function fetchOandaCandles(
  symbol: string,
  interval: string,
  count: number,
  opts?: { beforeMs?: number; fromMs?: number; toMs?: number },
): Promise<{ candles: OandaCandle[]; hasMore: boolean }> {
  if (!oandaConfigured()) return { candles: [], hasMore: false };
  const instrument = toOandaInstrument(symbol);
  const granularity = toOandaGranularity(interval);
  if (!instrument || !granularity) return { candles: [], hasMore: false };

  const n = Math.min(Math.max(1, count), 5000);
  const base = `${oandaBaseUrl()}/v3/instruments/${instrument}/candles`;
  let url: string;

  if (opts?.fromMs != null && opts?.toMs != null && opts.toMs > opts.fromMs) {
    const fromIso = new Date(opts.fromMs).toISOString();
    const toIso = new Date(opts.toMs).toISOString();
    url =
      `${base}?granularity=${granularity}` +
      `&from=${encodeURIComponent(fromIso)}` +
      `&to=${encodeURIComponent(toIso)}` +
      `&price=M`;
  } else if (opts?.beforeMs && opts.beforeMs > 0) {
    // Paginate backward: `count` candles strictly before `to` (exclusive boundary).
    const toIso = new Date(opts.beforeMs).toISOString();
    url = `${base}?granularity=${granularity}&count=${n}&to=${encodeURIComponent(toIso)}&price=M`;
  } else {
    url = `${base}?granularity=${granularity}&count=${n}&price=M`;
  }

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
  out.sort((a, b) => a.time - b.time);

  let hasMore = false;
  if (opts?.fromMs != null && opts?.toMs != null) {
    const oldest = out[0]?.time ?? 0;
    hasMore =
      out.length > 0 &&
      oldest > Date.now() - HISTORY_LOOKBACK_MS + barDurationMs(interval);
  } else if (opts?.beforeMs && opts.beforeMs > 0) {
    const oldest = out[0]?.time ?? 0;
    hasMore =
      out.length > 0 &&
      oldest > Date.now() - HISTORY_LOOKBACK_MS + barDurationMs(interval);
  } else {
    hasMore = out.length >= n;
  }
  return { candles: out, hasMore };
}

export interface OandaQuote {
  symbol: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  tradeable: boolean;
}

interface OandaPriceRow {
  instrument: string;
  bids?: { price: string }[];
  asks?: { price: string }[];
  tradeable?: boolean;
}

/**
 * Live bid/ask/mid for one or more symbols from OANDA. Requires OANDA_ACCOUNT_ID.
 */
export async function fetchOandaPricing(symbols: string[]): Promise<OandaQuote[]> {
  const accountId = oandaAccountId();
  if (!oandaConfigured() || !accountId) return [];
  const instruments = symbols
    .map((s) => toOandaInstrument(s))
    .filter((i): i is string => i != null);
  if (instruments.length === 0) return [];

  const url = `${oandaBaseUrl()}/v3/accounts/${accountId}/pricing?instruments=${instruments.join("%2C")}`;
  const res = await fetchWithTimeout(
    url,
    { headers: authHeaders(), cache: "no-store" },
    { timeoutMs: httpTimeoutMs(), label: "OANDA pricing" },
  );
  if (!res.ok) throw new Error(`OANDA pricing HTTP ${res.status}`);
  const data = (await res.json()) as { prices?: OandaPriceRow[] };
  return (data.prices ?? []).map((p) => {
    const bid = p.bids?.[0] ? Number(p.bids[0].price) : null;
    const ask = p.asks?.[0] ? Number(p.asks[0].price) : null;
    const mid = bid != null && ask != null ? (bid + ask) / 2 : (bid ?? ask);
    return {
      symbol: fromOandaInstrument(p.instrument),
      bid: bid != null && Number.isFinite(bid) ? bid : null,
      ask: ask != null && Number.isFinite(ask) ? ask : null,
      mid: mid != null && Number.isFinite(mid) ? mid : null,
      tradeable: p.tradeable !== false,
    };
  });
}

export interface OandaInstrument {
  symbol: string;
  displayName: string;
  type: string;
}

interface OandaInstrumentRow {
  name: string;
  displayName?: string;
  type?: string;
}

/**
 * The OANDA account's tradable instrument universe (forex + metals + CFDs).
 * Requires OANDA_ACCOUNT_ID. Returns [] when not configured or on failure.
 */
export async function fetchOandaInstruments(): Promise<OandaInstrument[]> {
  const accountId = oandaAccountId();
  if (!oandaConfigured() || !accountId) return [];
  const url = `${oandaBaseUrl()}/v3/accounts/${accountId}/instruments`;
  const res = await fetchWithTimeout(
    url,
    { headers: authHeaders(), cache: "no-store" },
    { timeoutMs: httpTimeoutMs(), label: "OANDA instruments" },
  );
  if (!res.ok) throw new Error(`OANDA instruments HTTP ${res.status}`);
  const data = (await res.json()) as { instruments?: OandaInstrumentRow[] };
  return (data.instruments ?? []).map((i) => ({
    symbol: fromOandaInstrument(i.name),
    displayName: i.displayName ?? i.name,
    type: i.type ?? "CURRENCY",
  }));
}
