import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { createApprovalRequest } from "@/lib/approvalFlow";
import { normalizeIntentSymbol } from "@/lib/markets/resolve";
import { DEFAULT_MARKET, rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import { getMtAccount, logAudit } from "@/lib/store";

const schema = z
  .object({
    symbol: z.string().min(1),
    side: z.enum(["buy", "sell"]),
    market: z.string().optional(),
    entry: z.number().nullish(),
    stop_loss: z.number().positive(),
    take_profit: z.number().nullish(),
    confidence: z.number().min(0).max(100).default(0),
    rationale: z.string().nullish(),
    recommendation_id: z.number().nullish(),
  })
  .strict();

/**
 * Session-authenticated chart path into the approval flow.
 *
 * Creates a pending intent only — never places an order. Confirmation still
 * goes through respond_approval / intents approve, the same choke point MCP
 * cards use. Direct broker execution is intentionally unreachable from here.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const body = schema.parse(await req.json());

    const account = await getMtAccount(user.id);
    if (!account?.metaapi_account_id || account.metaapi_account_id === "mt5local") {
      return NextResponse.json(
        { error: "اربط حساب MetaTrader السحابي أولاً." },
        { status: 400 },
      );
    }

    const marketErr = rejectNonForexMarket(body.market);
    if (marketErr) {
      return NextResponse.json({ error: marketErr }, { status: 400 });
    }
    const market = resolveActiveMarket(body.market ?? DEFAULT_MARKET);
    const symbol = normalizeIntentSymbol(body.symbol, market);

    const result = await createApprovalRequest(user.id, {
      symbol,
      side: body.side,
      market,
      entry: body.entry ?? null,
      stop_loss: body.stop_loss,
      take_profit: body.take_profit ?? null,
      confidence: body.confidence,
      rationale: body.rationale ?? "Chart ticket",
      recommendation_id: body.recommendation_id ?? null,
    });

    await logAudit(
      user.id,
      "chart_request_approval",
      JSON.stringify({
        intentId: result.intentId,
        symbol,
        side: body.side,
      }),
    );

    return NextResponse.json({
      ok: true,
      intentId: result.intentId,
      telegramDelivered: result.telegramDelivered,
    });
  } catch (e) {
    return handleError(e);
  }
}
