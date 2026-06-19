import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getSettings, logAudit, updateSettings } from "@/lib/store";
import {
  STYLE_DEFAULT_INTERVAL,
  TRADING_STYLES,
  type TradingStyle,
} from "@/lib/types";

/** Human-facing menu of trading styles (cadence presets). */
const STYLE_MENU: Record<
  TradingStyle,
  { labelAr: string; interval: string; cadence: string; capHint: string }
> = {
  scalp: {
    labelAr: "سكالبينغ — صفقات لحظية سريعة",
    interval: STYLE_DEFAULT_INTERVAL.scalp,
    cadence: "tick / 1–2s",
    capHint: "يتطلب سقف صفقات (scalp_max_trades)",
  },
  day: {
    labelAr: "تداول يومي",
    interval: STYLE_DEFAULT_INTERVAL.day,
    cadence: "30–60s",
    capHint: "سقف متوسط",
  },
  swing: {
    labelAr: "سوينغ — متوسط المدى",
    interval: STYLE_DEFAULT_INTERVAL.swing,
    cadence: "دقائق",
    capHint: "سقف منخفض",
  },
  position: {
    labelAr: "استثمار طويل المدى",
    interval: STYLE_DEFAULT_INTERVAL.position,
    cadence: "cron عادي",
    capHint: "سقف منخفض جداً",
  },
};

/** Bridge: read the current trading style + the selectable menu. */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const settings = await getSettings(userId);
    return NextResponse.json({
      trading_style: settings.trading_style,
      scalp_max_trades: settings.scalp_max_trades,
      analysis_interval: settings.analysis_interval ?? "1h",
      styles: TRADING_STYLES.map((key) => ({ key, ...STYLE_MENU[key] })),
    });
  } catch (e) {
    return handleError(e);
  }
}

const schema = z.object({
  trading_style: z.enum(TRADING_STYLES),
  /** Max concurrent trades for scalp (required when style=scalp). */
  scalp_max_trades: z.number().int().min(0).max(100).optional(),
  /** When true, also set analysis_interval to the style's default. */
  sync_interval: z.boolean().optional(),
});

/** Bridge: set the trading style (+ optional scalp cap / interval sync). */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());
    const style = body.trading_style as TradingStyle;

    const patch: Record<string, unknown> = { trading_style: style };
    if (body.scalp_max_trades !== undefined) {
      patch.scalp_max_trades = body.scalp_max_trades;
    }
    if (body.sync_interval) {
      patch.analysis_interval = STYLE_DEFAULT_INTERVAL[style];
    }

    await updateSettings(userId, patch);
    await logAudit(
      userId,
      "agent_style_change",
      `style=${style} cap=${body.scalp_max_trades ?? "—"}`,
    );

    const settings = await getSettings(userId);
    return NextResponse.json({
      ok: true,
      trading_style: settings.trading_style,
      scalp_max_trades: settings.scalp_max_trades,
      analysis_interval: settings.analysis_interval ?? "1h",
      needs_scalp_cap: style === "scalp" && settings.scalp_max_trades <= 0,
    });
  } catch (e) {
    return handleError(e);
  }
}
