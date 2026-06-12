import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAgentAuth, resolveAgentUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getBinanceCredentials, logAudit } from "@/lib/store";
import {
  cancelAllFuturesOrders,
  getFuturesPositions,
  placeFuturesExitOrder,
} from "@/lib/binanceFutures";

const schema = z
  .object({
    symbol: z.string().min(1),
    stop_loss: z.number().positive().nullish(),
    take_profit: z.number().positive().nullish(),
  })
  .refine((b) => b.stop_loss != null || b.take_profit != null, {
    message: "حدّد stop_loss أو take_profit (أو كليهما).",
  });

/**
 * Bridge: MT5-style SL/TP modification on an open futures position.
 * Cancels existing protective orders and re-places them at the new levels.
 */
export async function POST(req: NextRequest) {
  try {
    requireAgentAuth(req);
    const userId = await resolveAgentUserId();
    const body = schema.parse(await req.json());
    const symbol = body.symbol.toUpperCase();

    const creds = await getBinanceCredentials(userId);
    if (!creds) {
      return NextResponse.json(
        { ok: false, reason: "لا يوجد حساب Binance مرتبط." },
        { status: 400 },
      );
    }

    const positions = await getFuturesPositions(
      creds.apiKey,
      creds.apiSecret,
      creds.env,
      symbol,
    );
    const position = positions[0];
    if (!position) {
      return NextResponse.json(
        { ok: false, reason: `لا يوجد مركز مفتوح على ${symbol}.` },
        { status: 404 },
      );
    }
    const direction = position.positionAmt > 0 ? "long" : "short";
    const mark = position.markPrice;

    // Sanity: SL must be on the losing side, TP on the winning side.
    if (body.stop_loss != null) {
      const wrong =
        direction === "long" ? body.stop_loss >= mark : body.stop_loss <= mark;
      if (wrong) {
        return NextResponse.json(
          {
            ok: false,
            reason: `وقف الخسارة (${body.stop_loss}) في الاتجاه الخاطئ — السعر الحالي ${mark} والمركز ${direction}.`,
          },
          { status: 422 },
        );
      }
    }
    if (body.take_profit != null) {
      const wrong =
        direction === "long"
          ? body.take_profit <= mark
          : body.take_profit >= mark;
      if (wrong) {
        return NextResponse.json(
          {
            ok: false,
            reason: `جني الأرباح (${body.take_profit}) في الاتجاه الخاطئ — السعر الحالي ${mark} والمركز ${direction}.`,
          },
          { status: 422 },
        );
      }
    }

    // Replace protective orders atomically-ish: cancel all, then re-place.
    await cancelAllFuturesOrders(
      creds.apiKey,
      creds.apiSecret,
      creds.env,
      symbol,
    );

    const placed: string[] = [];
    if (body.stop_loss != null) {
      await placeFuturesExitOrder(
        creds.apiKey,
        creds.apiSecret,
        creds.env,
        symbol,
        direction,
        "stop_loss",
        body.stop_loss,
      );
      placed.push(`SL @ ${body.stop_loss}`);
    }
    if (body.take_profit != null) {
      await placeFuturesExitOrder(
        creds.apiKey,
        creds.apiSecret,
        creds.env,
        symbol,
        direction,
        "take_profit",
        body.take_profit,
      );
      placed.push(`TP @ ${body.take_profit}`);
    }

    await logAudit(
      userId,
      "agent_futures_modify",
      `${symbol} ${direction}: ${placed.join("، ")}`,
    );

    return NextResponse.json({
      ok: true,
      symbol,
      direction,
      markPrice: mark,
      applied: placed,
    });
  } catch (e) {
    return handleError(e);
  }
}
