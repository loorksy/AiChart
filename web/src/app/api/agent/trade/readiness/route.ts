import { withBridge } from "@/lib/bridge";
import { buildTradeReadiness } from "@/lib/bridge/tradeReadiness";
import { getSettings } from "@/lib/store";
import type { MarketType } from "@/lib/markets/types";
import { ApiError } from "@/lib/api";

/** Bridge: aggregated trade pre-flight — EA, quotes, risk, confidence gate. */
export const GET = withBridge(async ({ req, userId }) => {
  const { searchParams } = req.nextUrl;
  const settings = await getSettings(userId);
  const market = (searchParams.get("market") ??
    settings.active_market ??
    "crypto") as MarketType;
  const symbol = searchParams.get("symbol");
  const confidenceRaw = searchParams.get("confidence");
  const confidence =
    confidenceRaw != null && confidenceRaw !== ""
      ? Number(confidenceRaw)
      : undefined;

  if (
    confidence !== undefined &&
    (!Number.isFinite(confidence) || confidence < 0 || confidence > 100)
  ) {
    throw new ApiError(400, "confidence must be 0–100.");
  }

  return buildTradeReadiness({
    userId,
    symbol,
    market,
    confidence,
    practiceMode: searchParams.get("practice") === "true",
  });
}, { routeKey: "/api/agent/trade/readiness" });
