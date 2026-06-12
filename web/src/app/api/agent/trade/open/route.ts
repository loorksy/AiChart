import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAgentAuth, resolveAgentUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { createIntent, getLimits, getSettings, logAudit } from "@/lib/store";
import { executeIntent } from "@/lib/execution";
import type { MarketType } from "@/lib/markets/types";

const schema = z.object({
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  /** Quote amount (USDT) — defaults to per-trade budget from settings. */
  notional: z.number().positive().optional(),
  market: z.enum(["crypto", "forex"]).optional(),
  entry: z.number().nullish(),
  stop_loss: z.number().nullish(),
  take_profit: z.number().nullish(),
  confidence: z.number().min(0).max(100).default(0),
  rationale: z.string().nullish(),
  recommendation_id: z.number().nullish(),
  /** True when the human operator explicitly ordered/approved this trade. */
  approved_by_user: z.boolean().default(false),
  practice: z.boolean().default(false),
});

/**
 * Bridge: opens a real trade. Every call runs the full intent → Risk Guard →
 * broker pipeline; the Risk Guard can deny regardless of who asked.
 */
export async function POST(req: NextRequest) {
  try {
    requireAgentAuth(req);
    const userId = await resolveAgentUserId();
    const body = schema.parse(await req.json());

    const settings = await getSettings(userId);
    const limits = await getLimits(userId);
    const market = (body.market ??
      settings.active_market ??
      "crypto") as MarketType;

    const effectiveCapital =
      limits.max_capital_cap > 0
        ? Math.min(settings.max_capital, limits.max_capital_cap)
        : settings.max_capital;
    const notional =
      body.notional ?? (effectiveCapital * settings.per_trade_pct) / 100;

    const intent = await createIntent(userId, {
      recommendation_id: body.recommendation_id ?? null,
      symbol: body.symbol.toUpperCase(),
      side: body.side,
      notional,
      market,
      entry: body.entry ?? null,
      stop_loss: body.stop_loss ?? null,
      take_profit: body.take_profit ?? null,
      confidence: body.confidence,
      rationale: body.rationale ?? null,
      status: "approved",
      practice: body.practice,
    });

    const result = await executeIntent(userId, intent.id, {
      explicitApproval: body.approved_by_user,
      practiceMode: body.practice,
    });

    await logAudit(
      userId,
      "agent_trade_open",
      `${intent.symbol} ${intent.side} ${notional.toFixed(2)} USDT → ${result.status}${
        result.ok ? "" : ` (${result.reason})`
      }`,
    );

    return NextResponse.json({
      ok: result.ok,
      status: result.status,
      reason: result.reason,
      intentId: intent.id,
      tradeId: result.tradeId ?? null,
      trade: result.trade ?? null,
    });
  } catch (e) {
    return handleError(e);
  }
}
