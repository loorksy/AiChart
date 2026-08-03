import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { closeAllOpenTrades, closeOpenTrade } from "@/lib/tradeClose";
import { getTrade, listOpenTrades, logAudit } from "@/lib/store";
import { getForexLiveMid } from "@/lib/markets/forexPrice";
import { NON_FOREX_MARKET_MESSAGE } from "@/lib/marketPolicy";
import type { Trade } from "@/lib/types";

const schema = z
  .object({
    trade_id: z.number().int().positive().optional(),
    all: z.boolean().default(false),
    /** Preview only: reports what closing would realize, closes nothing. */
    dry_run: z.boolean().default(false),
  })
  .refine((b) => b.all || b.trade_id != null, {
    message: "حدّد trade_id أو all=true.",
  });

/**
 * What closeOpenTrade would actually do for this trade, computed without
 * calling it. Mirrors its own broker check exactly, so a preview that says
 * "would close" is never wrong about a gap the real call would have hit.
 */
async function previewClose(userId: number, trade: Trade) {
  if (trade.broker !== "mt5_local") {
    return {
      trade_id: trade.id,
      symbol: trade.symbol,
      would_close: false,
      reason: NON_FOREX_MARKET_MESSAGE,
    };
  }
  const price = await getForexLiveMid(userId, trade.symbol).catch(() => 0);
  const dir = trade.side === "buy" ? 1 : -1;
  const unrealizedPnl =
    price > 0 && trade.avg_price > 0 ? dir * (price - trade.avg_price) * trade.qty : null;
  return {
    trade_id: trade.id,
    symbol: trade.symbol,
    would_close: true,
    live_price: price > 0 ? price : null,
    estimated_pnl: unrealizedPnl,
  };
}

/** Bridge: closes one open trade (or all of them) and reports realized PnL. */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());

    if (body.dry_run) {
      if (body.all) {
        const open = await listOpenTrades(userId);
        const previews = await Promise.all(open.map((t) => previewClose(userId, t)));
        return NextResponse.json({ ok: true, dry_run: true, trades: previews });
      }
      const trade = await getTrade(userId, body.trade_id as number);
      if (!trade || trade.status !== "open") {
        return NextResponse.json({
          ok: false,
          dry_run: true,
          reason: "صفقة غير موجودة أو مغلقة.",
        });
      }
      return NextResponse.json({ ok: true, dry_run: true, ...(await previewClose(userId, trade)) });
    }

    if (body.all) {
      const result = await closeAllOpenTrades(userId);
      await logAudit(
        userId,
        "agent_trade_close",
        `all: closed ${result.closed}, pnl ${result.totalPnl.toFixed(2)} USD`,
      );
      return NextResponse.json({ ok: result.failed === 0, ...result });
    }

    const result = await closeOpenTrade(userId, body.trade_id as number);
    await logAudit(
      userId,
      "agent_trade_close",
      `#${body.trade_id} ${result.symbol}: ${result.ok ? `pnl ${result.pnl.toFixed(2)} USD` : result.reason}`,
    );
    return NextResponse.json(result);
  } catch (e) {
    return handleError(e);
  }
}
