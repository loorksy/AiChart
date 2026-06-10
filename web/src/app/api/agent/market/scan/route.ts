import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAgentAuth, resolveAgentUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getSettings, isMasterKillOn } from "@/lib/store";
import { resolveMonitorAssets } from "@/lib/allowedAssets";
import { scanSymbol } from "@/lib/monitor";

const schema = z.object({
  symbols: z.array(z.string()).max(30).optional(),
  interval: z.string().optional(),
});

/**
 * Bridge: cheap code-only opportunity scan over the crypto watchlist.
 * Returns candidates only when multiple technical signals align — the agent
 * should analyze deeply only when a candidate appears.
 */
export async function POST(req: NextRequest) {
  try {
    requireAgentAuth(req);
    const userId = await resolveAgentUserId();
    const body = schema.parse(await req.json().catch(() => ({})));

    if (await isMasterKillOn()) {
      return NextResponse.json({
        killSwitch: true,
        scanned: [],
        candidates: [],
      });
    }

    const settings = await getSettings(userId);
    const symbols =
      body.symbols && body.symbols.length > 0
        ? body.symbols.map((s) => s.toUpperCase())
        : await resolveMonitorAssets(settings.allowed_assets);
    const interval = body.interval ?? "1h";

    const candidates = [];
    const errors: string[] = [];
    for (const symbol of symbols) {
      try {
        const candidate = await scanSymbol(symbol, settings.style, interval);
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
      scanned: symbols,
      candidates,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    return handleError(e);
  }
}
