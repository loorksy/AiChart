import { NextRequest, NextResponse } from "next/server";
import { requireUser, handleError } from "@/lib/api";
import { getKlines } from "@/lib/binance";
import { getEaCandles } from "@/lib/eaStore";

const ALLOWED = new Set(["1m", "5m", "15m", "1h", "4h", "1d", "1w"]);

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const symbol = (req.nextUrl.searchParams.get("symbol") || "BTCUSDT")
      .toUpperCase()
      .replace(/[^A-Z0-9.]/g, "");
    const intervalRaw = req.nextUrl.searchParams.get("interval") || "1h";
    const interval = ALLOWED.has(intervalRaw) ? intervalRaw : "1h";
    const limit = Math.min(
      Math.max(Number(req.nextUrl.searchParams.get("limit") || 200), 10),
      500,
    );
    const market = req.nextUrl.searchParams.get("market") === "forex"
      ? "forex"
      : "crypto";

    if (market === "forex") {
      const cached = await getEaCandles(user.id, symbol, interval);
      let candles: Candle[] = [];
      if (cached) {
        try {
          const bars = JSON.parse(cached.candles_json) as Candle[];
          candles = bars
            .map((b) => ({
              time: Number(b.time),
              open: Number(b.open),
              high: Number(b.high),
              low: Number(b.low),
              close: Number(b.close),
            }))
            .filter((b) => Number.isFinite(b.time) && b.time > 0)
            .slice(-limit);
        } catch {
          candles = [];
        }
      }

      // No cached data yet: the EA streams its configured StreamSymbol; the
      // chart will populate once a heartbeat with this symbol's candles arrives.
      return NextResponse.json({
        symbol,
        interval,
        market,
        candles,
        pending: candles.length === 0,
      });
    }

    const raw = await getKlines(symbol, interval, limit, "prod");
    return NextResponse.json({
      symbol,
      interval,
      market,
      candles: raw.map((c) => ({
        time: Math.floor(c.openTime / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}
