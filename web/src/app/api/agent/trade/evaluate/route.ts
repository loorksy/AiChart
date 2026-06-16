import { NextRequest, NextResponse } from "next/server";
import { getPrice } from "@/lib/binance";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { buildAccountProfile } from "@/lib/accountProfile";
import { getEaConnection, isHeartbeatFresh, parseEaSymbolSpecs } from "@/lib/eaStore";
import { buildSnapshot, buildForexSnapshot } from "@/lib/market";
import { profileForInterval } from "@/lib/analysisProfile";
import { fetchMarketContext } from "@/lib/marketContext";
import { getIntent, getTrade } from "@/lib/store";

async function livePrice(
  userId: number,
  symbol: string,
  market: string,
): Promise<number> {
  if (market === "forex") {
    const conn = await getEaConnection(userId);
    if (!conn || !isHeartbeatFresh(conn.last_heartbeat_at)) return 0;
    const spec = parseEaSymbolSpecs(conn.symbol_specs_json).find(
      (s) => s.symbol?.toUpperCase() === symbol.toUpperCase(),
    );
    if (!spec) return 0;
    const bid = Number(spec.bid) || 0;
    const ask = Number(spec.ask) || 0;
    return bid > 0 && ask > 0 ? (bid + ask) / 2 : bid || ask || 0;
  }
  return (await getPrice(symbol, "prod")) ?? 0;
}

/** Bridge: live snapshot for an open trade — price, candles, PnL, context. */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const tradeId = Number(req.nextUrl.searchParams.get("trade_id"));
    if (!Number.isInteger(tradeId) || tradeId <= 0) {
      return NextResponse.json({ error: "trade_id مطلوب." }, { status: 400 });
    }

    const trade = await getTrade(userId, tradeId);
    if (!trade || trade.status !== "open") {
      return NextResponse.json({ error: "صفقة غير موجودة أو مغلقة." }, { status: 404 });
    }

    const market = trade.market ?? "crypto";
    const interval = "15m";
    const price = await livePrice(userId, trade.symbol, market);
    const snapshot =
      market === "forex"
        ? await buildForexSnapshot(userId, trade.symbol, interval)
        : await buildSnapshot(trade.symbol, interval, "prod");

    let unrealizedPnl = 0;
    if (price > 0 && trade.avg_price > 0) {
      const dir = trade.side === "buy" ? 1 : -1;
      unrealizedPnl = dir * (price - trade.avg_price) * trade.qty;
    }

    let intentStops: { sl: number | null; tp: number | null } = { sl: null, tp: null };
    if (trade.intent_id) {
      const intent = await getIntent(trade.intent_id);
      intentStops = {
        sl: intent?.stop_loss ?? null,
        tp: intent?.take_profit ?? null,
      };
    }

    const context = await fetchMarketContext(
      trade.symbol,
      profileForInterval(interval),
    );
    const profile = await buildAccountProfile(userId, trade.symbol);

    return NextResponse.json({
      trade_id: tradeId,
      symbol: trade.symbol,
      side: trade.side,
      qty: trade.qty,
      avg_price: trade.avg_price,
      live_price: price,
      unrealized_pnl: unrealizedPnl,
      stop_loss: intentStops.sl,
      take_profit: intentStops.tp,
      interval,
      snapshot: {
        rsi14: snapshot.rsi14,
        trend: snapshot.trend,
        macd: snapshot.macd,
        summary: snapshot.summary,
      },
      market_context: context,
      accountProfile: profile,
    });
  } catch (e) {
    return handleError(e);
  }
}
