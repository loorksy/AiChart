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
import { STYLE_DEFAULT_INTERVAL } from "@/lib/types";
import type { MarketType } from "@/lib/markets/types";

/** Bridge: scalp session status + user permission settings. */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const [session, settings] = await Promise.all([
      getScalpSession(userId),
      getSettings(userId),
    ]);
    return NextResponse.json({
      session: session ?? null,
      scalp_enabled: settings.scalp_enabled,
      mode: settings.scalp_execution_mode,
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

    // Permission check — operator must enable scalp from the dashboard first.
    if (!settings.scalp_enabled) {
      return NextResponse.json(
        {
          error:
            "وضع السكالب معطّل. فعّله من لوحة التحكّم ← إعدادات السكالب أولاً.",
          needs_enable: true,
        },
        { status: 403 },
      );
    }

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
      executionMode: settings.scalp_execution_mode === "live" ? "live" : "paper",
    });
    await logAudit(
      userId,
      "scalp_start",
      `symbol=${body.symbol} cap=${maxTrades} tf=${interval} mode=${settings.scalp_execution_mode}`,
    );

    return NextResponse.json({
      ok: true,
      active: true,
      symbol: body.symbol,
      market,
      interval,
      max_trades: maxTrades,
      notional,
      mode: settings.scalp_execution_mode,
    });
  } catch (e) {
    return handleError(e);
  }
}
