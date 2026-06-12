import { NextRequest, NextResponse } from "next/server";
import { requireUser, handleError } from "@/lib/api";
import { parseAllowedAssets, isOpenAssetsPolicy } from "@/lib/allowedAssets";
import { buildSymbolPerformance } from "@/lib/analytics";
import { getSettings, listTrades } from "@/lib/store";

const TICKER_24H_URL = "https://data-api.binance.vision/api/v3/ticker/24hr";

type TickerRow = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
};

/** Historical PnL per symbol + 24h change for command-center heatmap. */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const settings = await getSettings(user.id);
    const trades = await listTrades(user.id, 500);
    const performance = buildSymbolPerformance(trades);

    const openPolicy = isOpenAssetsPolicy(settings.allowed_assets);
    const symbols = openPolicy
      ? performance.map((p) => p.symbol)
      : parseAllowedAssets(settings.allowed_assets, settings.active_market);

    const wanted = new Set(symbols.map((s) => s.toUpperCase()));
    const tickers: Record<string, { price: number; changePct: number }> = {};

    if (wanted.size > 0) {
      const res = await fetch(TICKER_24H_URL, { next: { revalidate: 60 } });
      if (res.ok) {
        const rows = (await res.json()) as TickerRow[];
        for (const t of rows) {
          if (!wanted.has(t.symbol)) continue;
          tickers[t.symbol] = {
            price: Number(t.lastPrice),
            changePct: Number(t.priceChangePercent),
          };
        }
      }
    }

    const cells = symbols.map((symbol) => {
      const perf = performance.find((p) => p.symbol === symbol);
      const live = tickers[symbol];
      return {
        symbol,
        historicalPnl: perf?.pnl ?? 0,
        trades: perf?.trades ?? 0,
        winRate: perf?.winRate ?? 0,
        changePct24h: live?.changePct ?? 0,
        price: live?.price ?? null,
      };
    });

    return NextResponse.json({
      ok: true,
      cells,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return handleError(e);
  }
}
