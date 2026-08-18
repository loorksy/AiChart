import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError, requirePlatformAccess } from "@/lib/api";
import { resolveMarketDataSource } from "@/lib/markets/marketDataSource";

/** Which pipe is serving market data — a platform-level status, not per-user. */
export async function GET() {
  try {
    await requirePlatformAccess();
    const decision = await resolveMarketDataSource();
    return NextResponse.json({
      active: decision.source,
      reason: decision.reason,
      preference: decision.preference,
      available: decision.available,
    });
  } catch (e) {
    return handleError(e);
  }
}

const schema = z.object({
  source: z.enum(["auto", "oanda"]),
});

/** Preference is stored nowhere; the decision is always OANDA. */
export async function PUT(req: NextRequest) {
  try {
    await requirePlatformAccess();
    schema.parse(await req.json());
    const decision = await resolveMarketDataSource();
    return NextResponse.json({
      ok: true,
      active: decision.source,
      reason: decision.reason,
      preference: decision.preference,
      available: decision.available,
    });
  } catch (e) {
    return handleError(e);
  }
}
