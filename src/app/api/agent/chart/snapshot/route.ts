import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getChartLayoutById, getOrCreateChartLayout } from "@/lib/store";
import { DEFAULT_MARKET, rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import { pickLiveLayoutId } from "@/lib/chart/liveCapture";
import {
  captureChartWithPlatformFallback,
  layoutOverlaysFromState,
} from "@/lib/chart/platformCapture";

const schema = z.object({
  symbol: z.string().min(1),
  interval: z.string().default("1h"),
  market: z.string().optional(),
  layout_id: z.string().optional(),
  response_format: z.enum(["json", "png"]).optional().default("json"),
  include_drawings: z.boolean().optional(),
  include_studies: z.boolean().optional(),
  live_session: z.boolean().optional(),
});

/**
 * Bridge: chart PNGs for a symbol — the two-shot TradingView pair from a
 * live tab, or an honest named failure. There is no fallback image: a
 * caller without a live browser session gets the reason, not a substitute.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());

    const marketErr = rejectNonForexMarket(body.market);
    if (marketErr) {
      return NextResponse.json({ error: marketErr }, { status: 400 });
    }
    const market = resolveActiveMarket(body.market ?? DEFAULT_MARKET);

    let layoutId = body.layout_id;
    if (layoutId) {
      const owned = await getChartLayoutById(layoutId, userId);
      if (!owned) {
        layoutId = undefined;
      }
    }
    layoutId = pickLiveLayoutId(userId, layoutId);
    if (!layoutId) {
      const primary = await getOrCreateChartLayout(userId, body.symbol.toUpperCase());
      layoutId = primary?.id;
    }

    // When the operator has no live tab and the shot falls to the platform
    // chart session, the requesting layout's own drawings/studies travel
    // with the request — rendered for that shot, counted off the widget.
    const layoutForOverlays = layoutId
      ? await getChartLayoutById(layoutId, userId)
      : null;
    const overlays = layoutOverlaysFromState(layoutForOverlays?.state_json ?? null);

    const captured = await captureChartWithPlatformFallback({
      userId,
      layoutId,
      symbol: body.symbol,
      interval: body.interval,
      market,
      includeDrawings: body.include_drawings,
      includeStudies: body.include_studies,
      liveSession: body.live_session !== false,
      platformDrawings: body.include_drawings === false ? [] : overlays.drawings,
      platformStudies: body.include_studies === false ? [] : overlays.studies,
    });

    if (!captured.ok) {
      return NextResponse.json(
        { error: "تعذّر التقاط شارت TradingView.", reason: captured.reason },
        { status: 503 },
      );
    }

    if (body.response_format === "json") {
      return NextResponse.json({
        ok: true,
        content_type: captured.content_type,
        image_source: captured.image_source,
        drawings_included: captured.drawings_included,
        studies_included: captured.studies_included,
        fallback_reason: captured.fallback_reason ?? null,
        image_base64: captured.image_base64,
        images: captured.images,
      });
    }

    return new NextResponse(Buffer.from(captured.image_base64, "base64"), {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return handleError(e);
  }
}
