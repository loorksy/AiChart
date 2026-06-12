import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth, resolveAgentUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getBinanceCredentials } from "@/lib/store";
import {
  getFuturesBalance,
  getFuturesOpenOrders,
  getFuturesPositions,
} from "@/lib/binanceFutures";

/**
 * Bridge: live USDT-M futures snapshot — positions (with liquidation price,
 * unrealized PnL, leverage), pending orders, and futures wallet balance.
 */
export async function GET(req: NextRequest) {
  try {
    requireAgentAuth(req);
    const userId = await resolveAgentUserId();
    const creds = await getBinanceCredentials(userId);
    if (!creds) {
      return NextResponse.json(
        { ok: false, reason: "لا يوجد حساب Binance مرتبط." },
        { status: 400 },
      );
    }

    const symbol = req.nextUrl.searchParams.get("symbol") ?? undefined;
    const [positions, orders, balance] = await Promise.all([
      getFuturesPositions(creds.apiKey, creds.apiSecret, creds.env, symbol),
      getFuturesOpenOrders(creds.apiKey, creds.apiSecret, creds.env, symbol),
      getFuturesBalance(creds.apiKey, creds.apiSecret, creds.env),
    ]);

    return NextResponse.json({
      ok: true,
      env: creds.env,
      balance,
      positions: positions.map((p) => ({
        ...p,
        direction: p.positionAmt > 0 ? "long" : "short",
      })),
      pendingOrders: orders,
    });
  } catch (e) {
    return handleError(e);
  }
}
