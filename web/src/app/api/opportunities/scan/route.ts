import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_MARKET, rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { getSettings, getLimits, touchManualScan } from "@/lib/store";
import { runOpportunityScan } from "@/lib/opportunityScan";
import { normalizeInterval } from "@/lib/intervals";

const schema = z.object({
  deep: z.boolean().optional(),
  skipCooldown: z.boolean().optional(),
  symbol: z.string().min(3).max(20).optional(),
  interval: z.string().min(2).max(4).optional(),
  market: z.string().optional(),
  focusOnly: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const body = schema.parse(await req.json().catch(() => ({})));

    const marketErr = rejectNonForexMarket(body.market);
    if (marketErr) {
      return NextResponse.json({ error: marketErr }, { status: 400 });
    }

    const settings = await getSettings(user.id);
    const limits = await getLimits(user.id);
    const market = resolveActiveMarket(body.market ?? settings.active_market ?? DEFAULT_MARKET);

    const result = await runOpportunityScan(user.id, settings, limits, {
      deep: body.deep ?? false,
      skipCooldown: body.skipCooldown ?? true,
      symbol: body.symbol?.toUpperCase(),
      interval: body.interval ? normalizeInterval(body.interval) : undefined,
      market,
      focusOnly: body.focusOnly,
    });

    await touchManualScan(user.id);

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: e.issues[0]?.message ?? "بيانات غير صالحة." },
        { status: 400 },
      );
    }
    return handleError(e);
  }
}
