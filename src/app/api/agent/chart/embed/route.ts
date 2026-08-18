import { NextRequest, NextResponse } from "next/server";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { ApiError, handleError } from "@/lib/api";
import {
  isChartEmbedConfigured,
  mintChartEmbedUrl,
} from "@/lib/embedChartToken";
import { coerceToGold } from "@/lib/gold";
import { normalizeInterval } from "@/lib/intervals";
import { getChartLayoutById, getOrCreateChartLayout } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mints a capability URL for the MCP live-chart iframe. The token is bound to
 * the bridge user (HMAC), not a browser cookie — Claude's sandbox will not
 * send the Lonora session.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    if (!isChartEmbedConfigured()) {
      throw new ApiError(503, "Chart embed signing is not configured.");
    }
    const { searchParams } = new URL(req.url);
    const requestedId = searchParams.get("layout_id") ?? searchParams.get("id");
    const symbol = coerceToGold(searchParams.get("symbol"));
    const interval = normalizeInterval(searchParams.get("interval") || "15m");
    const theme = searchParams.get("theme") === "light" ? "light" : "dark";
    const locale = searchParams.get("locale") === "en" ? "en" : "ar";

    const byId = requestedId ? await getChartLayoutById(requestedId, userId) : null;
    const layout = byId ?? (await getOrCreateChartLayout(userId, symbol));
    const embed_url = mintChartEmbedUrl({
      userId,
      layoutId: layout.id,
      symbol: coerceToGold(layout.symbol || symbol),
      interval: normalizeInterval(layout.interval || interval),
      theme,
      locale,
    });
    return NextResponse.json({
      ok: true,
      bound: true,
      layout_id: layout.id,
      symbol: coerceToGold(layout.symbol || symbol),
      interval: normalizeInterval(layout.interval || interval),
      embed_url,
    });
  } catch (e) {
    return handleError(e);
  }
}
