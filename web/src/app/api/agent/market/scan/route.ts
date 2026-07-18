import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_MARKET, rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { resolveScanAssetsForMarket } from "@/lib/allowedAssets.server";
import { getSettings } from "@/lib/store";
import { scanForexSymbol } from "@/lib/monitor";

const schema = z.object({
  scope: z.enum(["symbol_scan", "timeframe_scan", "market_scan"]),
  symbols: z.array(z.string()).max(12).optional(),
  interval: z.string().optional(),
  intervals: z.array(z.string()).min(2).max(4).optional(),
  market: z.string().optional(),
}).strict();

/**
 * Bridge: cheap code-only opportunity scan over the watchlist (forex via EA).
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

    if (body.scope === "symbol_scan" && symbols.length !== 1) {
      return NextResponse.json({ error: "symbol_scan_requires_one_symbol" }, { status: 400 });
    }
    if (
      body.scope === "timeframe_scan" &&
      (symbols.length !== 1 || !body.intervals?.length)
    ) {
      return NextResponse.json(
        { error: "timeframe_scan_requires_one_symbol_and_intervals" },
        { status: 400 },
      );
    }
    if (body.scope !== "timeframe_scan" && body.intervals?.length) {
      return NextResponse.json({ error: "intervals_not_allowed_for_scope" }, { status: 400 });
    }
    const intervals = body.scope === "timeframe_scan" ? body.intervals! : [interval];
    if (symbols.length * intervals.length > 30) {
      return NextResponse.json({ error: "scan_scope_too_broad" }, { status: 400 });
    }

    const screeningItems = [];
    const errors: string[] = [];
    for (const symbol of symbols) {
      for (const scanInterval of intervals) {
        try {
          const item = await scanForexSymbol(userId, symbol, scanInterval);
          if (item) {
            screeningItems.push({
              symbol: item.symbol,
              interval: item.interval,
              activityScore: item.activityScore,
              neutralEvidence: item.neutralEvidence,
              sourceHealth: item.sourceHealth,
              quoteFreshnessMs: item.quoteFreshnessMs,
              spread: item.spread,
              volatilityActivityPct: item.volatilityActivityPct,
              candleCoverage: item.candleCoverage,
              structuralActivity: item.structuralActivity,
              neutralSummary: item.neutralSummary,
              summary: item.snapshot.summary,
              price: item.snapshot.price,
            });
          }
        } catch (e) {
          errors.push(`${symbol}@${scanInterval}: ${e instanceof Error ? e.message : "error"}`);
        }
      }
    }

    return NextResponse.json({
      market,
      scope: { mode: body.scope, symbols, intervals },
      screeningItems,
      note: "Activity ranking is neutral evidence only. The MCP host model must compare the bounded items and choose BUY, SELL, or WAIT.",
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    return handleError(e);
  }
}
