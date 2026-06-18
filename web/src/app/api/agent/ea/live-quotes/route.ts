import { withBridge } from "@/lib/bridge";
import { buildEaLiveQuotesSummary } from "@/lib/eaLiveState";
import { getEaQuoteTickMetrics } from "@/lib/eaQuoteMetrics";

/** Bridge: EA live quote cache with freshness metadata (spreadPips, isFresh, source). */
export const GET = withBridge(async ({ req, userId }) => {
  const symbol = req.nextUrl.searchParams.get("symbol")?.toUpperCase().trim();
  const wantMetrics = req.nextUrl.searchParams.get("metrics") === "1";
  const summary = await buildEaLiveQuotesSummary(userId);

  if (symbol) {
    const quote =
      summary.quotes.find((q) => q.symbol.toUpperCase() === symbol) ?? null;
    const tickMetrics = wantMetrics
      ? getEaQuoteTickMetrics(userId, symbol)
      : undefined;
    return {
      symbol,
      quote,
      quotesOk: Boolean(quote && quote.bid > 0 && quote.ask > 0),
      quoteAgeMs: quote?.quoteAgeMs ?? null,
      spreadPips: quote?.spreadPips ?? null,
      isFresh: quote?.isFresh ?? false,
      source: quote?.source ?? null,
      staleThresholdMs: summary.staleThresholdMs,
      ...(tickMetrics ? { tickMetrics } : {}),
    };
  }

  if (wantMetrics) {
    return {
      ...summary,
      tickMetrics: getEaQuoteTickMetrics(userId),
    };
  }

  return summary;
}, { routeKey: "/api/agent/ea/live-quotes" });
