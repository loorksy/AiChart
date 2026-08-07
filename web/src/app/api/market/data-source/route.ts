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
  // The user's own linked MetaTrader account is the only pipe; `auto` and
  // `metaapi` are accepted for stored-settings compatibility and resolve to
  // the same decision.
  source: z.enum(["auto", "metaapi"]),
});

/** Persist the preference; the decision is always the linked account. */
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
