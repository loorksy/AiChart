import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { getSettings, logAudit, updateSettings } from "@/lib/store";
import {
  STYLE_DEFAULT_INTERVAL,
  TRADING_STYLES,
  type TradingStyle,
} from "@/lib/types";

const STYLE_MENU: Record<
  TradingStyle,
  { labelAr: string; interval: string }
> = {
  scalp: { labelAr: "سكالب", interval: STYLE_DEFAULT_INTERVAL.scalp },
  day: { labelAr: "يومي", interval: STYLE_DEFAULT_INTERVAL.day },
  swing: { labelAr: "سوينغ", interval: STYLE_DEFAULT_INTERVAL.swing },
  position: { labelAr: "مركزي", interval: STYLE_DEFAULT_INTERVAL.position },
};

export async function GET() {
  try {
    const user = await requirePlatformAccess();
    const settings = await getSettings(user.id);
    return NextResponse.json({
      trading_style: settings.trading_style,
      styles: TRADING_STYLES.map((key) => ({ key, ...STYLE_MENU[key] })),
    });
  } catch (e) {
    return handleError(e);
  }
}

const schema = z.object({
  trading_style: z.enum(TRADING_STYLES),
  sync_interval: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const body = schema.parse(await req.json());
    const style = body.trading_style as TradingStyle;
    const patch: Record<string, unknown> = { trading_style: style };
    if (body.sync_interval !== false) {
      patch.analysis_interval = STYLE_DEFAULT_INTERVAL[style];
    }
    await updateSettings(user.id, patch);
    await logAudit(user.id, "web_style_change", `style=${style}`);
    const settings = await getSettings(user.id);
    return NextResponse.json({
      ok: true,
      trading_style: settings.trading_style,
      suggested_interval: STYLE_DEFAULT_INTERVAL[style],
    });
  } catch (e) {
    return handleError(e);
  }
}
