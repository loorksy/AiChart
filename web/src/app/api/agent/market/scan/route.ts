import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_MARKET, rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { resolveScanAssetsForMarket } from "@/lib/allowedAssets.server";
import { getSettings } from "@/lib/store";
import { scanForexSymbol, scoreOpportunity, type OpportunityCandidate } from "@/lib/monitor";
import type { MarketSnapshot } from "@/lib/market";
import { resolveMarketDataSource } from "@/lib/markets/marketDataSource";
import { fetchAnalysisCandleFeed } from "@/lib/markets/analysisCandleFeed";
import { computeForexIndicators } from "@/lib/ohlc/indicators";

const schema = z.object({
  symbols: z.array(z.string()).max(30).optional(),
  interval: z.string().optional(),
  market: z.string().optional(),
});

/**
 * No linked account to read from — the same scoring code
 * (`scoreOpportunity`) run on an analysis-only snapshot instead of an empty
 * scan (plan §5: scan_market is analysis-only, no account tie-in). Deliberately
 * NOT built on `buildForexSnapshot`/`scanForexSymbol` — that function is also
 * used by `chart/multiTimeframeCapture.ts` (chart-facing, MT-only per the
 * plan), so this stays a separate, self-contained path rather than risk
 * threading an analysis fallback into shared chart-facing code.
 */
async function scanAnalysisOnlySymbol(
  symbol: string,
  interval: string,
): Promise<OpportunityCandidate | null> {
  const fed = await fetchAnalysisCandleFeed(symbol, interval, 200);
  if (fed.candles.length < 20) return null;

  const indicators = computeForexIndicators(fed.symbol, fed.interval, fed.candles, "reference_feed");
  const last = fed.candles[fed.candles.length - 1]!;
  const dayMs = 24 * 60 * 60 * 1000;
  const windowCandles = fed.candles.filter((c) => c.time >= last.time - dayMs);
  const refCandles = windowCandles.length >= 2 ? windowCandles : fed.candles;
  const openPrice = refCandles[0]!.open;
  const change24hPct = openPrice > 0 ? ((last.close - openPrice) / openPrice) * 100 : 0;

  const snapshot: MarketSnapshot = {
    symbol: fed.symbol,
    interval: fed.interval,
    price: last.close,
    change24hPct,
    high24h: Math.max(...refCandles.map((c) => c.high)),
    low24h: Math.min(...refCandles.map((c) => c.low)),
    rsi14: indicators.rsi14,
    sma20: indicators.sma20,
    sma50: indicators.sma50,
    ema20: indicators.ema20,
    macd: indicators.macd,
    atr14: indicators.atr14,
    trend: indicators.trend,
    summary: indicators.summary,
  };
  return scoreOpportunity(snapshot);
}

/**
 * Bridge: cheap code-only opportunity scan over the watchlist.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json().catch(() => ({})));

    const marketErr = rejectNonForexMarket(body.market);
    if (marketErr) {
      return NextResponse.json({ error: marketErr }, { status: 400 });
    }

    const settings = await getSettings(userId);
    const market = resolveActiveMarket(body.market ?? DEFAULT_MARKET);
    const interval = body.interval ?? "5m";

    const symbols =
      body.symbols && body.symbols.length > 0
        ? body.symbols.map((s) => s.toUpperCase())
        : await resolveScanAssetsForMarket(settings.allowed_assets, market, userId);

    const decision = await resolveMarketDataSource(userId, null);

    const candidates = [];
    const errors: string[] = [];
    for (const symbol of symbols) {
      try {
        const candidate = decision.available.metaapi
          ? await scanForexSymbol(userId, symbol, interval)
          : await scanAnalysisOnlySymbol(symbol, interval);
        if (candidate) {
          candidates.push({
            symbol: candidate.symbol,
            interval: candidate.interval,
            score: candidate.score,
            signals: candidate.signals,
            summary: candidate.snapshot.summary,
            price: candidate.snapshot.price,
          });
        }
      } catch (e) {
        errors.push(`${symbol}: ${e instanceof Error ? e.message : "خطأ"}`);
      }
    }

    return NextResponse.json({
      market,
      scanned: symbols,
      candidates,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    return handleError(e);
  }
}
