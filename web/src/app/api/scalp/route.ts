import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import {
  getLimits,
  getScalpSession,
  getSettings,
  logAudit,
  pauseScalpSession,
  resumeScalpSession,
  startScalpSession,
  stopScalpSession,
  updateSettings,
} from "@/lib/store";
import { STYLE_DEFAULT_INTERVAL } from "@/lib/types";
import type { MarketType } from "@/lib/markets/types";

/** User dashboard: scalp permission settings + live autonomous-session status. */
export async function GET() {
  try {
    const user = await requirePlatformAccess();
    const [settings, session] = await Promise.all([
      getSettings(user.id),
      getScalpSession(user.id),
    ]);
    return NextResponse.json({
      scalp_enabled: settings.scalp_enabled,
      scalp_execution_mode: settings.scalp_execution_mode,
      // Expose paused/active sessions too (not just active) so the UI can resume.
      session:
        session && session.status && session.status !== "stopped"
          ? session
          : null,
    });
  } catch (e) {
    return handleError(e);
  }
}

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("settings"),
    scalp_enabled: z.number().int().min(0).max(1),
    scalp_execution_mode: z.enum(["paper", "live"]),
  }),
  z.object({
    action: z.literal("start"),
    /** Optional focus symbol; empty = autonomous scan of allowed assets. */
    symbol: z.string().optional(),
    market: z.enum(["crypto", "forex"]).optional(),
    interval: z.string().optional(),
    max_trades: z.number().int().min(1).max(100).optional(),
  }),
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("stop") }),
]);

/**
 * User dashboard: control the autonomous scalp session.
 * - settings: grant/revoke permission + paper|live mode.
 * - start/pause/resume/stop: lifecycle of the autonomous session loop.
 * Execution still runs entirely through executeIntent → Risk Guard.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const body = schema.parse(await req.json());

    if (body.action === "settings") {
      await updateSettings(user.id, {
        scalp_enabled: body.scalp_enabled,
        scalp_execution_mode: body.scalp_execution_mode,
      });
      await logAudit(
        user.id,
        "scalp_settings",
        `enabled=${body.scalp_enabled} mode=${body.scalp_execution_mode}`,
      );
      const settings = await getSettings(user.id);
      return NextResponse.json({
        ok: true,
        scalp_enabled: settings.scalp_enabled,
        scalp_execution_mode: settings.scalp_execution_mode,
      });
    }

    if (body.action === "pause") {
      await pauseScalpSession(user.id);
      await logAudit(user.id, "scalp_pause", "");
      return NextResponse.json({ ok: true, status: "paused" });
    }

    if (body.action === "resume") {
      await resumeScalpSession(user.id);
      await logAudit(user.id, "scalp_resume", "");
      return NextResponse.json({ ok: true, status: "active" });
    }

    if (body.action === "stop") {
      await stopScalpSession(user.id, "user_stopped");
      await logAudit(user.id, "scalp_stop", "user");
      return NextResponse.json({ ok: true, status: "stopped" });
    }

    // start
    const settings = await getSettings(user.id);
    if (!settings.scalp_enabled) {
      return NextResponse.json(
        {
          error: "وضع السكالب معطّل. فعّله من إعدادات السكالب أولاً.",
          needs_enable: true,
        },
        { status: 403 },
      );
    }

    const limits = await getLimits(user.id);
    const market = (body.market ?? settings.active_market ?? "crypto") as MarketType;
    const maxTrades = body.max_trades ?? settings.scalp_max_trades ?? 0;
    if (maxTrades <= 0) {
      return NextResponse.json(
        {
          error: "حدّد سقف الصفقات (max_trades) لبدء الجلسة.",
          needs_scalp_cap: true,
        },
        { status: 400 },
      );
    }

    const effectiveCapital =
      limits.max_capital_cap > 0
        ? Math.min(settings.max_capital, limits.max_capital_cap)
        : settings.max_capital;
    const notional = (effectiveCapital * settings.per_trade_pct) / 100;
    const interval =
      body.interval ??
      settings.analysis_interval ??
      STYLE_DEFAULT_INTERVAL.scalp;

    await startScalpSession(user.id, {
      symbol: body.symbol ?? "",
      market,
      interval,
      maxTrades,
      notional,
      executionMode: settings.scalp_execution_mode === "live" ? "live" : "paper",
    });
    await logAudit(
      user.id,
      "scalp_start",
      `market=${market} cap=${maxTrades} tf=${interval} mode=${settings.scalp_execution_mode} symbol=${body.symbol ?? "*"}`,
    );

    return NextResponse.json({
      ok: true,
      status: "active",
      market,
      interval,
      max_trades: maxTrades,
      notional,
      execution_mode: settings.scalp_execution_mode,
    });
  } catch (e) {
    return handleError(e);
  }
}
