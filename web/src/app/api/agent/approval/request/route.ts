import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_MARKET, rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { createApprovalRequest } from "@/lib/approvalFlow";
import { normalizeIntentSymbol } from "@/lib/markets/resolve";
import { logAudit } from "@/lib/store";

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

    const result = await createApprovalRequest(userId, {
      symbol: normalizeIntentSymbol(body.symbol, market),
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
    });

    await logAudit(
      userId,
      "agent_approval_request",
      `#${result.intentId} ${body.symbol} ${body.side}`,
    );

    return NextResponse.json({
      ok: true,
      intentId: result.intentId,
      telegramDelivered: result.telegramDelivered,
      telegramReasonAr: result.reasonAr,
      message:
        "أُرسلت بطاقة الموافقة مع أزرار ✅/❌ — انتظر ضغط الزر قبل التنفيذ.",
    });
  } catch (e) {
    return handleError(e);
  }
}
