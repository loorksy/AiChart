import type {
  Datafeed,
  DatafeedSubscribeCallback,
  Period,
  SymbolInfo,
} from "@klinecharts/pro";
import type { KLineData } from "klinecharts";
import { normalizeTimestamp } from "@/lib/chart/chartTimeAnchor";
import { defaultKlineLimit } from "@/lib/ohlc/klineLimits";
import { barDurationMs } from "@/lib/intervals";
import { FOREX_INSTRUMENTS } from "@/lib/markets/forexInstruments";
import type { MarketType } from "@/lib/markets/types";
import { periodToInterval } from "@/lib/chart/klinePeriod";

interface RawCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface InstrumentRow {
  symbol: string;
}

function toSymbolInfo(ticker: string, market: MarketType): SymbolInfo {
  const upper = ticker.toUpperCase();
  return {
    ticker: upper,
    shortName: upper,
    name: upper,
    exchange: market === "forex" ? "OANDA" : "BINANCE",
    market,
    priceCurrency: upper.includes("JPY") ? "JPY" : "USD",
    pricePrecision: upper.includes("JPY") ? 3 : 5,
    type: market === "forex" ? "FX" : "CRYPTO",
  };
}

function toKLineData(rows: RawCandle[]): KLineData[] {
  return rows.map((c) => ({
    timestamp: normalizeTimestamp(c.time),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume ?? 0,
  }));
}

function dedupe(rows: KLineData[]): KLineData[] {
  const byTs = new Map<number, KLineData>();
  for (const row of rows) {
    if (row.timestamp > 0) byTs.set(row.timestamp, row);
  }
  return [...byTs.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function parseInstrumentSymbols(data: unknown): string[] {
  if (Array.isArray(data)) {
    return data
      .map((row) => {
        if (typeof row === "string") return row.toUpperCase();
        if (row && typeof row === "object" && "symbol" in row) {
          return String((row as InstrumentRow).symbol).toUpperCase();
        }
        return "";
      })
      .filter(Boolean);
  }
  if (data && typeof data === "object") {
    const wrapped = data as {
      instruments?: InstrumentRow[];
      symbols?: string[];
    };
    if (Array.isArray(wrapped.symbols)) {
      return wrapped.symbols.map((s) => s.toUpperCase());
    }
    if (Array.isArray(wrapped.instruments)) {
      return wrapped.instruments.map((r) => r.symbol.toUpperCase());
    }
  }
  return [];
}

/** OANDA / Binance klines via /api/market/klines — used by KLineChart Pro. */
export class AiChartDatafeed implements Datafeed {
  private timer: ReturnType<typeof setInterval> | null = null;
  private pollMs: number;
  private symbolCache: SymbolInfo[] | null = null;
  private symbolCacheTs = 0;

  constructor(
    private market: MarketType = "forex",
    pollMs = 30_000,
  ) {
    this.pollMs = pollMs;
  }

  setMarket(market: MarketType) {
    if (this.market !== market) {
      this.market = market;
      this.symbolCache = null;
    }
  }

  setPollMs(ms: number) {
    this.pollMs = ms;
  }

  private async loadSymbols(): Promise<SymbolInfo[]> {
    const now = Date.now();
    if (this.symbolCache && now - this.symbolCacheTs < 5 * 60_000) {
      return this.symbolCache;
    }

    let tickers: string[] = [];
    try {
      const params = new URLSearchParams({
        market: this.market === "forex" ? "forex" : "crypto",
        wrapped: "1",
      });
      const res = await fetch(`/api/instruments?${params}`, { cache: "no-store" });
      if (res.ok) {
        tickers = parseInstrumentSymbols(await res.json());
      }
    } catch {
      /* fallback below */
    }

    if (tickers.length === 0 && this.market === "forex") {
      tickers = FOREX_INSTRUMENTS.map((i) => i.symbol);
    }

    this.symbolCache = tickers.map((t) => toSymbolInfo(t, this.market));
    this.symbolCacheTs = now;
    return this.symbolCache;
  }

  async searchSymbols(search?: string): Promise<SymbolInfo[]> {
    const q = (search ?? "").trim().toUpperCase().replace("/", "");
    const all = await this.loadSymbols();
    if (!q) return all.slice(0, 80);
    return all.filter((s) => s.ticker.includes(q)).slice(0, 80);
  }

  async getHistoryKLineData(
    symbol: SymbolInfo,
    period: Period,
    from: number,
    to: number,
  ): Promise<KLineData[]> {
    const interval = periodToInterval(period);
    const barMs = barDurationMs(interval);
    const spanBars = Math.ceil(Math.max(to - from, barMs) / barMs) + 2;
    const limit = Math.min(
      5000,
      Math.max(defaultKlineLimit(interval, this.market), spanBars, 500),
    );

    const params = new URLSearchParams({
      symbol: symbol.ticker,
      interval,
      market: this.market,
      limit: String(limit),
      fresh: "1",
      from: String(from),
      to: String(to),
    });

    const res = await fetch(`/api/market/klines?${params}`, { cache: "no-store" });
    const data = (await res.json()) as { candles?: RawCandle[] };
    const rows = dedupe(toKLineData(data.candles ?? []));
    return rows.filter((c) => c.timestamp >= from && c.timestamp <= to);
  }

  subscribe(
    symbol: SymbolInfo,
    period: Period,
    callback: DatafeedSubscribeCallback,
  ): void {
    this.unsubscribe(symbol, period);
    const interval = periodToInterval(period);

    const poll = async () => {
      try {
        const params = new URLSearchParams({
          symbol: symbol.ticker,
          interval,
          market: this.market,
          limit: "3",
          fresh: "1",
        });
        const res = await fetch(`/api/market/klines?${params}`, { cache: "no-store" });
        const data = (await res.json()) as { candles?: RawCandle[] };
        const tail = dedupe(toKLineData(data.candles ?? []));
        const last = tail[tail.length - 1];
        if (last) callback(last);
      } catch {
        /* keep last bar */
      }
    };

    void poll();
    this.timer = setInterval(() => void poll(), this.pollMs);
  }

  unsubscribe(_symbol: SymbolInfo, _period: Period): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
