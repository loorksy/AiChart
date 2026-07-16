import { withBridge } from "@/lib/bridge";
import { buildTradeReadiness } from "@/lib/bridge/tradeReadiness";
import { DEFAULT_MARKET, rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import { ApiError } from "@/lib/api";

/** Bridge: aggregated technical trade pre-flight — EA, quotes, and account state. */
export const GET = withBridge(async ({ req, userId }) => {
  const { searchParams } = req.nextUrl;
  const rawMarket = searchParams.get("market") ?? DEFAULT_MARKET;
  const marketErr = rejectNonForexMarket(rawMarket);
  if (marketErr) throw new ApiError(400, marketErr);
  const market = resolveActiveMarket(rawMarket ?? DEFAULT_MARKET);
  const symbol = searchParams.get("symbol");

  return buildTradeReadiness({
    userId,
    symbol,
    market,
    practiceMode: searchParams.get("practice") === "true",
  });
}, { routeKey: "/api/agent/trade/readiness" });
