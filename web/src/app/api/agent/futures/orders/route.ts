import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAgentAuth, resolveAgentUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getBinanceCredentials, logAudit } from "@/lib/store";
import {
  cancelAllFuturesOrders,
  cancelFuturesOrder,
  getFuturesOpenOrders,
} from "@/lib/binanceFutures";

/** Bridge: lists pending futures orders (optionally for one symbol). */
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
    const orders = await getFuturesOpenOrders(
      creds.apiKey,
      creds.apiSecret,
      creds.env,
      symbol,
    );
    return NextResponse.json({ ok: true, env: creds.env, orders });
  } catch (e) {
    return handleError(e);
  }
}

const cancelSchema = z
  .object({
    symbol: z.string().min(1),
    order_id: z.number().int().positive().optional(),
    all: z.boolean().default(false),
  })
  .refine((b) => b.all || b.order_id != null, {
    message: "حدّد order_id أو all=true.",
  });

/** Bridge: cancels one pending futures order, or all for a symbol. */
export async function DELETE(req: NextRequest) {
  try {
    requireAgentAuth(req);
    const userId = await resolveAgentUserId();
    const body = cancelSchema.parse(await req.json());
    const symbol = body.symbol.toUpperCase();

    const creds = await getBinanceCredentials(userId);
    if (!creds) {
      return NextResponse.json(
        { ok: false, reason: "لا يوجد حساب Binance مرتبط." },
        { status: 400 },
      );
    }

    if (body.all) {
      await cancelAllFuturesOrders(
        creds.apiKey,
        creds.apiSecret,
        creds.env,
        symbol,
      );
      await logAudit(userId, "agent_futures_cancel", `${symbol}: all orders`);
      return NextResponse.json({ ok: true, symbol, cancelled: "all" });
    }

    await cancelFuturesOrder(
      creds.apiKey,
      creds.apiSecret,
      creds.env,
      symbol,
      body.order_id as number,
    );
    await logAudit(
      userId,
      "agent_futures_cancel",
      `${symbol}: order #${body.order_id}`,
    );
    return NextResponse.json({ ok: true, symbol, cancelled: body.order_id });
  } catch (e) {
    return handleError(e);
  }
}
