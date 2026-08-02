import { withBridge } from "@/lib/bridge";
import { buildEaLiveQuotesSummary } from "@/lib/eaLiveState";
import { getEaQuoteTickMetrics } from "@/lib/eaQuoteMetrics";
import { resolveForexBackendForUser } from "@/lib/store";

/**
 * Bridge: EA live quote cache with freshness metadata (spreadPips, isFresh, source).
 *
 * The cache is fed by EA heartbeats and tick pushes, so it is empty by
 * construction for MetaApi and MT5-bridge accounts. Those get told which
 * backend they are on and where the price actually lives, rather than an empty
 * quote list that reads as a dead or disconnected market.
 */
export const GET = withBridge(async ({ req, userId }) => {
  const symbol = req.nextUrl.searchParams.get("symbol")?.toUpperCase().trim();
  const wantMetrics = req.nextUrl.searchParams.get("metrics") === "1";

  const backend = await resolveForexBackendForUser(userId);
  if (backend !== "ea") {
    return {
      backend,
      applies: false,
      quotes: [],
      ...(symbol ? { symbol, quote: null, quotesOk: false, isFresh: false } : {}),
      note_ar:
        backend === "metaapi"
          ? "حسابك مربوط عبر MetaApi ولا يوجد EA يبثّ الأسعار — استخدم get_market_price للسعر اللحظي."
          : "حسابك مربوط عبر جسر MT5 المستضاف ولا يوجد EA يبثّ الأسعار — استخدم get_market_price للسعر اللحظي.",
    };
  }

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
