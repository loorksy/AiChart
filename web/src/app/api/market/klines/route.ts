import { NextRequest, NextResponse } from "next/server";
import { requireUser, handleError } from "@/lib/api";
import { getKlines } from "@/lib/binance";

const ALLOWED = new Set(["1m", "5m", "15m", "1h", "4h", "1d", "1w"]);

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const symbol = (req.nextUrl.searchParams.get("symbol") || "BTCUSDT")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    const intervalRaw = req.nextUrl.searchParams.get("interval") || "1h";
    const interval = ALLOWED.has(intervalRaw) ? intervalRaw : "1h";
    const limit = Math.min(
      Math.max(Number(req.nextUrl.searchParams.get("limit") || 200), 10),
      500,
    );

    const candles = await getKlines(symbol, interval, limit, "prod");
    return NextResponse.json({
      symbol,
      interval,
      candles: candles.map((c) => ({
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
