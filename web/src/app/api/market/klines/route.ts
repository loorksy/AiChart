import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { getForexBackend } from "@/lib/brokers/forexBackend";
import { getKlines } from "@/lib/binance";
import { getEaCandles } from "@/lib/eaStore";
import { getMetaApi } from "@/lib/metaapi/client";
import { getMtAccount } from "@/lib/store";

const ALLOWED = new Set(["1m", "5m", "15m", "1h", "4h", "1d", "1w"]);

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

function mapInterval(interval: string): string {
  if (interval === "1w") return "1w";
  return interval;
}

async function metaApiForexCandles(
  userId: number,
  symbol: string,
  interval: string,
  limit: number,
): Promise<Candle[]> {
  const row = await getMtAccount(userId);
  if (!row?.metaapi_account_id) return [];

  const api = await getMetaApi();
  const account = await api.metatraderAccountApi.getAccount(row.metaapi_account_id);
  if (account.state !== "DEPLOYED") return [];

  const tf = mapInterval(interval);
  const raw = (await account.getHistoricalCandles(
    symbol,
    tf,
    undefined,
    limit,
  )) as Array<{
    time: string | Date;
    open: number;
    high: number;
    low: number;
    close: number;
  }>;
  return raw
    .map((c) => ({
      time: Math.floor(new Date(c.time as string | Date).getTime() / 1000),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    }))
    .filter((b) => Number.isFinite(b.time) && b.time > 0)
    .sort((a, b) => a.time - b.time)
    .slice(-limit);
}

export async function GET(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
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
      if (getForexBackend() === "metaapi") {
        const candles = await metaApiForexCandles(
          user.id,
          symbol,
          interval,
          limit,
        );
        return NextResponse.json({
          symbol,
          interval,
          market,
          candles,
          pending: candles.length === 0,
        });
      }

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
