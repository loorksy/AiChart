import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import {
  isSymbolAllowed,
  resolveScanAssetsForMarket,
} from "@/lib/allowedAssets";
import { getSettings, isMasterKillOn } from "@/lib/store";
import { scanForexSymbol, scanSymbol } from "@/lib/monitor";
import type { MarketType } from "@/lib/markets/types";

const schema = z.object({
  symbols: z.array(z.string()).max(30).optional(),
  interval: z.string().optional(),
  market: z.enum(["crypto", "forex"]).optional(),
});

/**
 * Bridge: cheap code-only opportunity scan over the watchlist.
 * Uses crypto Binance data or forex EA-streamed candles per active_market.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json().catch(() => ({})));

    if (await isMasterKillOn()) {
      return NextResponse.json({
        killSwitch: true,
        scanned: [],
        candidates: [],
      });
    }

    const settings = await getSettings(userId);
    const market: MarketType =
      body.market ?? settings.active_market ?? "crypto";
    const interval = body.interval ?? settings.analysis_interval ?? "1h";

    const symbols =
      body.symbols && body.symbols.length > 0
        ? body.symbols.map((s) => s.toUpperCase())
        : await resolveScanAssetsForMarket(settings.allowed_assets, market);

    const candidates = [];
    const errors: string[] = [];
    for (const symbol of symbols) {
      if (!isSymbolAllowed(settings.allowed_assets, symbol, market)) {
        continue;
      }
      try {
        const candidate =
          market === "forex"
            ? await scanForexSymbol(userId, symbol, settings.style, interval)
            : await scanSymbol(symbol, settings.style, interval);
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
      killSwitch: false,
      market,
      scanned: symbols,
      candidates,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    return handleError(e);
  }
}
