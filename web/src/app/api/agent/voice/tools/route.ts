import { NextRequest, NextResponse } from "next/server";
import { requirePaidAccess, handleError } from "@/lib/api";
import { DEFAULT_MARKET, resolveActiveMarket } from "@/lib/marketPolicy";
import { getUnifiedPrice } from "@/lib/markets";
import { getEaConnection, isHeartbeatFresh } from "@/lib/eaStore";
import { listTrades } from "@/lib/store";

/**
 * Fast data lookups for the LIVE voice session. These are the low-latency
 * half of the voice tool set: current price, account state, open positions —
 * answered in about a second so the conversation stays natural. Anything
 * analytical (recommendations, entries/stops, execution) still goes through
 * ask_aichart → the canonical agent; this endpoint never produces advice.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requirePaidAccess();
    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      args?: Record<string, unknown>;
    };
    const name = String(body.name ?? "");
    const args = body.args ?? {};

    switch (name) {
      case "get_market_price": {
        const symbol = String(args.symbol ?? "").trim();
        if (!symbol) return NextResponse.json({ ok: false, error: "symbol مطلوب." });
        const market = resolveActiveMarket(DEFAULT_MARKET);
        const { resolved, price } = await getUnifiedPrice(symbol, market, user.id);
        return NextResponse.json({ ok: true, symbol: resolved.symbol, price });
      }
      case "get_account_overview": {
        const conn = await getEaConnection(user.id);
        if (!conn) {
          return NextResponse.json({
            ok: true,
            connected: false,
            note: "لا يوجد حساب تداول مربوط.",
          });
        }
        return NextResponse.json({
          ok: true,
          connected: true,
          fresh: isHeartbeatFresh(conn.last_heartbeat_at ?? null),
          balance: conn.balance ?? null,
          equity: conn.equity ?? null,
        });
      }
      case "get_open_trades": {
        const trades = await listTrades(user.id, 50);
        const open = trades
          .filter((t) => t.status === "open")
          .map((t) => ({
            symbol: t.symbol,
            side: t.side,
            qty: t.qty,
            entry: t.avg_price,
          }));
        return NextResponse.json({ ok: true, count: open.length, trades: open });
      }
      default:
        return NextResponse.json({ ok: false, error: "أداة غير معروفة." });
    }
  } catch (err) {
    // Voice tools degrade to a spoken failure, never a broken session.
    try {
      return NextResponse.json({ ok: false, error: "تعذّر تنفيذ الأداة حالياً." });
    } catch {
      return handleError(err);
    }
  }
}
