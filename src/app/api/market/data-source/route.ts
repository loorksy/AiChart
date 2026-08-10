import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError, requirePlatformAccess } from "@/lib/api";
import { updateSettings } from "@/lib/store";
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
  // OANDA is the only pipe and is platform-level, not user-selectable;
  // `auto`, `metaapi`, and `oanda` are all accepted for stored-settings
  // compatibility and resolve to the same decision.
  source: z.enum(["auto", "metaapi", "oanda"]),
});

/** Persist the (now vestigial) preference; the decision is always OANDA. */
export async function PUT(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const { source } = schema.parse(await req.json());
    await updateSettings(user.id, { market_data_source: source });
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
