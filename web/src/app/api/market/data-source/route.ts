import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError, requirePlatformAccess } from "@/lib/api";
import { updateSettings } from "@/lib/store";
import { resolveMarketDataSource } from "@/lib/markets/marketDataSource";

/** Which pipe is serving this account's charts, and which ones could. */
export async function GET() {
  try {
    const user = await requirePlatformAccess();
    const decision = await resolveMarketDataSource(user.id);
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
  // `auto` hands the choice back to the platform: the cloud account when
  // linked, then the user's own terminal, then the platform feed.
  source: z.enum(["auto", "oanda", "ea", "metaapi"]),
});

/** Pin the source, or hand the choice back with `auto`. */
export async function PUT(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const { source } = schema.parse(await req.json());
    await updateSettings(user.id, { market_data_source: source });
    const decision = await resolveMarketDataSource(user.id);
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
