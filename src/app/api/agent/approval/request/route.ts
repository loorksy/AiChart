import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_MARKET, rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { createApprovalRequest } from "@/lib/approvalFlow";
import { getRiskBudget } from "@/lib/execution";
import { normalizeIntentSymbol } from "@/lib/markets/resolve";
import { getIntent, logAudit, resolveBrokerForMarket } from "@/lib/store";

const schema = z.object({
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  market: z.string().optional(),
  entry: z.number().nullish(),
  stop_loss: z.number().positive(),
  take_profit: z.number().nullish(),
  confidence: z.number().min(0).max(100).default(0),
  rationale: z.string().nullish(),
  recommendation_id: z.number().nullish(),
  practice: z.boolean().default(false),
  kind: z
    .enum(["trade", "practice"])
    .optional(),
  photo_url: z.string().nullish(),
  order_type: z.enum(["market", "limit", "stop"]).default("market"),
  limit_price: z.number().positive().optional(),
  /** Preview only: shows the card that would be sent, sends nothing. */
  dry_run: z.boolean().default(false),
}).strict();

export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());

    const marketErr = rejectNonForexMarket(body.market);
    if (marketErr) {
      return NextResponse.json({ error: marketErr }, { status: 400 });
    }
    const market = resolveActiveMarket(body.market ?? DEFAULT_MARKET);
    const symbol = normalizeIntentSymbol(body.symbol, market);

    if (body.dry_run) {
      const broker = await resolveBrokerForMarket(userId, market);
      const budget = await getRiskBudget(userId, broker);
      return NextResponse.json({
        ok: true,
        dry_run: true,
        would_send: {
          symbol,
          side: body.side,
          market,
          entry: body.entry ?? null,
          stop_loss: body.stop_loss ?? null,
          take_profit: body.take_profit ?? null,
          rationale: body.rationale ?? null,
          order_type: body.order_type,
          limit_price: body.limit_price ?? null,
        },
        computed: budget
          ? {
              equity: budget.equity,
              currency: budget.currency,
              risk_pct: budget.riskPct,
              risk_amount: budget.riskAmount,
              broker,
            }
          : null,
        blocking_reason: budget ? null : "verified_equity_unavailable",
      });
    }

    const result = await createApprovalRequest(userId, {
      symbol,
      side: body.side,
      market,
      entry: body.entry ?? null,
      stop_loss: body.stop_loss ?? null,
      take_profit: body.take_profit ?? null,
      confidence: body.confidence,
      rationale: body.rationale ?? null,
      recommendation_id: body.recommendation_id ?? null,
      practice: body.practice,
      kind: body.kind,
      photoUrl: body.photo_url ?? null,
      order_type: body.order_type,
      limit_price: body.limit_price ?? null,
    });

    await logAudit(
      userId,
      "agent_approval_request",
      `#${result.intentId} ${body.symbol} ${body.side}`,
    );

    // Server-verified, not caller-echoed: the widget renders THIS, the
    // actually-persisted intent, never the raw request body — createIntent
    // normalizes the symbol and stamps the server-computed notional (risk
    // amount), so re-deriving from body would risk showing the operator a
    // figure that isn't what was actually queued.
    const intent = await getIntent(result.intentId, userId);

    return NextResponse.json({
      ok: true,
      intentId: result.intentId,
      telegramDelivered: result.telegramDelivered,
      telegramReasonAr: result.reasonAr,
      message:
        "أُرسلت بطاقة الموافقة مع أزرار ✅/❌ — انتظر ضغط الزر قبل التنفيذ.",
      intent: intent
        ? {
            id: intent.id,
            symbol: intent.symbol,
            side: intent.side,
            entry: intent.entry,
            stop_loss: intent.stop_loss,
            take_profit: intent.take_profit,
            notional: intent.notional,
            broker: intent.broker,
            rationale: intent.rationale,
            status: intent.status,
            order_type: intent.order_type,
            limit_price: intent.limit_price,
          }
        : null,
    });
  } catch (e) {
    return handleError(e);
  }
}
