import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_MARKET, rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { isSymbolAllowed } from "@/lib/allowedAssets";
import { resolveScanAssetsForMarket } from "@/lib/allowedAssets.server";
import { getSettings } from "@/lib/store";
import { scanForexSymbol } from "@/lib/monitor";

const schema = z.object({
  symbols: z.array(z.string()).max(30).optional(),
  interval: z.string().optional(),
  market: z.string().optional(),
});

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
    const market = resolveActiveMarket(body.market ?? settings.active_market ?? DEFAULT_MARKET);
    const interval = body.interval ?? settings.analysis_interval ?? "1h";

    const symbols =
      body.symbols && body.symbols.length > 0
        ? body.symbols.map((s) => s.toUpperCase())
        : await resolveScanAssetsForMarket(settings.allowed_assets, market, userId);

    const candidates = [];
    const errors: string[] = [];
    for (const symbol of symbols) {
      if (!isSymbolAllowed(settings.allowed_assets, symbol, market)) {
        continue;
      }
      try {
        const candidate = await scanForexSymbol(
          userId,
          symbol,
          settings.style,
          interval,
        );
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
