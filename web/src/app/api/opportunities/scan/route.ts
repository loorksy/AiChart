import { NextRequest, NextResponse } from "next/server";
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
  market: z.enum(["crypto", "forex"]).optional(),
  focusOnly: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const body = schema.parse(await req.json().catch(() => ({})));

    const settings = await getSettings(user.id);
    const limits = await getLimits(user.id);

    const result = await runOpportunityScan(user.id, settings, limits, {
      deep: body.deep ?? false,
      skipCooldown: body.skipCooldown ?? true,
      symbol: body.symbol?.toUpperCase(),
      interval: body.interval ? normalizeInterval(body.interval) : undefined,
      market: body.market,
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
