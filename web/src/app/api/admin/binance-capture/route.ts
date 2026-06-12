import { NextResponse } from "next/server";
import { requireAdmin, handleError } from "@/lib/api";
import {
  captureBinanceChart,
  getBinanceCaptureStatus,
  resolvePlaywrightBrowsersDir,
  chromiumBinaryExists,
} from "@/lib/binanceChartCapture";
import { getBinanceCaptureConfig } from "@/lib/binanceCaptureConfig";

export async function GET() {
  try {
    await requireAdmin();
    const cfg = getBinanceCaptureConfig();
    const [status, browsersDir, binaryExists] = await Promise.all([
      getBinanceCaptureStatus(),
      resolvePlaywrightBrowsersDir(),
      chromiumBinaryExists(),
    ]);
    return NextResponse.json({
      ...status,
      config: {
        timeoutMs: cfg.timeoutMs,
        cacheTtlMs: cfg.cacheTtlMs,
        viewport: cfg.viewport,
        defaultMarket: cfg.defaultMarket,
      },
      binaryExists,
      browsersDir,
    });
  } catch (e) {
    return handleError(e);
  }
}

/** Admin smoke test — captures BTCUSDT (or ?symbol=) and returns metadata only. */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const url = new URL(req.url);
    const symbol = url.searchParams.get("symbol") ?? "BTCUSDT";
    const market =
      url.searchParams.get("market_type") === "spot" ? "spot" : "futures";

    const result = await captureBinanceChart({
      symbol,
      market_type: market,
      interval: "1h",
      userId: admin.id,
    });

    if (!result) {
      return NextResponse.json(
        { ok: false, error: "فشل الالتقاط — راجع binance-capture/status." },
        { status: 503 },
      );
    }

    return NextResponse.json({
      ok: true,
      symbol,
      market_type: market,
      source: result.source,
      bytes: result.buffer.length,
    });
  } catch (e) {
    return handleError(e);
  }
}
