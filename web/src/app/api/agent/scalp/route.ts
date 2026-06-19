import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import {
  getLimits,
  getScalpSession,
  getSettings,
  logAudit,
  startScalpSession,
  stopScalpSession,
} from "@/lib/store";
import { scalpLiveEnabled } from "@/lib/scalp/worker";
import { STYLE_DEFAULT_INTERVAL } from "@/lib/types";
import type { MarketType } from "@/lib/markets/types";

/** Bridge: scalp session status. */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const session = await getScalpSession(userId);
    return NextResponse.json({
      session: session ?? null,
      live_enabled: scalpLiveEnabled(),
      mode: scalpLiveEnabled() ? "live" : "paper",
    });
  } catch (e) {
    return handleError(e);
  }
}

const schema = z.object({
  action: z.enum(["start", "stop"]),
  symbol: z.string().optional(),
  market: z.enum(["crypto", "forex"]).optional(),
  interval: z.string().optional(),
  max_trades: z.number().int().min(1).max(100).optional(),
  notional: z.number().positive().optional(),
});

/** Bridge: start/stop a scalp session for the operator. */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());

    if (body.action === "stop") {
      await stopScalpSession(userId);
      await logAudit(userId, "scalp_stop", "");
      return NextResponse.json({ ok: true, active: false });
    }

    // start
    if (!body.symbol) {
      return NextResponse.json(
        { error: "symbol مطلوب لبدء جلسة سكالب." },
        { status: 400 },
      );
    }
    const settings = await getSettings(userId);
    const limits = await getLimits(userId);
    const market = (body.market ?? settings.active_market ?? "crypto") as
      MarketType;
    const maxTrades =
      body.max_trades ?? settings.scalp_max_trades ?? 0;
    if (maxTrades <= 0) {
      return NextResponse.json(
        {
          error:
            "حدّد max_trades (سقف الصفقات) — السكالب يتطلب سقفاً صريحاً.",
          needs_scalp_cap: true,
        },
        { status: 400 },
      );
    }

    const effectiveCapital =
      limits.max_capital_cap > 0
        ? Math.min(settings.max_capital, limits.max_capital_cap)
        : settings.max_capital;
    const notional =
      body.notional ?? (effectiveCapital * settings.per_trade_pct) / 100;

    const interval =
      body.interval ?? settings.analysis_interval ?? STYLE_DEFAULT_INTERVAL.scalp;

    await startScalpSession(userId, {
      symbol: body.symbol,
      market,
      interval,
      maxTrades,
      notional,
    });
    await logAudit(
      userId,
      "scalp_start",
      `symbol=${body.symbol} cap=${maxTrades} tf=${interval} mode=${scalpLiveEnabled() ? "live" : "paper"}`,
    );

    return NextResponse.json({
      ok: true,
      active: true,
      symbol: body.symbol,
      market,
      interval,
      max_trades: maxTrades,
      notional,
      mode: scalpLiveEnabled() ? "live" : "paper",
    });
  } catch (e) {
    return handleError(e);
  }
}
