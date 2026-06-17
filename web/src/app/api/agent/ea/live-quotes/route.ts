import { withBridge } from "@/lib/bridge";
import { buildEaLiveQuotesSummary } from "@/lib/eaLiveState";

/** Bridge: EA live quote cache with freshness metadata (spreadPips, isFresh, source). */
export const GET = withBridge(async ({ req, userId }) => {
  const symbol = req.nextUrl.searchParams.get("symbol")?.toUpperCase().trim();
  const summary = await buildEaLiveQuotesSummary(userId);

  if (symbol) {
    const quote =
      summary.quotes.find((q) => q.symbol.toUpperCase() === symbol) ?? null;
    return {
      symbol,
      quote,
      quotesOk: Boolean(quote && quote.bid > 0 && quote.ask > 0),
      quoteAgeMs: quote?.quoteAgeMs ?? null,
      spreadPips: quote?.spreadPips ?? null,
      isFresh: quote?.isFresh ?? false,
      source: quote?.source ?? null,
      staleThresholdMs: summary.staleThresholdMs,
    };
  }

  return summary;
}, { routeKey: "/api/agent/ea/live-quotes" });
