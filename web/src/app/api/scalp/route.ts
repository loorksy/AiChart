import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
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

/** User dashboard: current scalp session status. */
export async function GET() {
  try {
    const user = await requirePlatformAccess();
    const session = await getScalpSession(user.id);
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
  symbol: z.string().max(30).optional(),
  market: z.enum(["crypto", "forex"]).optional(),
  interval: z.string().max(8).optional(),
  max_trades: z.number().int().min(1).max(100).optional(),
  notional: z.number().positive().optional(),
});

/** User dashboard: start/stop the scalp session. */
export async function POST(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const body = schema.parse(await req.json());

    if (body.action === "stop") {
      await stopScalpSession(user.id);
      await logAudit(user.id, "scalp_stop", "ui");
      return NextResponse.json({ ok: true, active: false });
    }

    if (!body.symbol) {
      return NextResponse.json(
        { error: "اختر رمزاً لبدء جلسة السكالب." },
        { status: 400 },
      );
    }
    const settings = await getSettings(user.id);
    const limits = await getLimits(user.id);
    const market = (body.market ?? settings.active_market ?? "crypto") as
      MarketType;
    const maxTrades = body.max_trades ?? settings.scalp_max_trades ?? 0;
    if (maxTrades <= 0) {
      return NextResponse.json(
        { error: "حدّد سقف الصفقات (max_trades).", needs_scalp_cap: true },
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

    await startScalpSession(user.id, {
      symbol: body.symbol,
      market,
      interval,
      maxTrades,
      notional,
    });
    await logAudit(
      user.id,
      "scalp_start",
      `ui symbol=${body.symbol} cap=${maxTrades} tf=${interval} mode=${scalpLiveEnabled() ? "live" : "paper"}`,
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
