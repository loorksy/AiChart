import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_MARKET } from "@/lib/marketPolicy";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getRecommendation, getSettings } from "@/lib/store";
import { buildChartSnapshotBufferForMarket } from "@/lib/chartSnapshot";
import { overlaysFromRecommendation } from "@/lib/chartOverlays";
import { parseChartDrawingsJson } from "@/lib/chartDrawings";
import type { MarketType } from "@/lib/markets/types";

/**
 * Bridge: annotated chart PNG for a recommendation (token auth, no cookies).
 * A stored recommendation's REPORT render — levels over platform candles
 * (server render — see the justification in chartSnapshot.ts). The error hint
 * below already steers live views to capture_chart_snapshot; this route is
 * never a live-chart substitute.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await resolveBridgeUserId(req);
    const { id } = await ctx.params;
    const recId = Number(id);
    if (!Number.isFinite(recId) || recId <= 0) {
      return NextResponse.json({ error: "معرّف غير صالح." }, { status: 400 });
    }

    const rec = await getRecommendation(recId, userId);
    if (!rec || rec.user_id !== userId) {
      return NextResponse.json({ error: "غير موجود." }, { status: 404 });
    }

    const settings = await getSettings(userId);
    const market = (rec.market ?? DEFAULT_MARKET) as MarketType;

    const buffer = await buildChartSnapshotBufferForMarket(
      userId,
      rec.symbol,
      rec.timeframe ?? "1h",
      market,
      {
        overlays: overlaysFromRecommendation(rec),
        drawings: parseChartDrawingsJson(rec.chart_drawings_json),
        patternName: rec.pattern_name,
      },
    );

    if (!buffer) {
      return NextResponse.json(
        {
          error: "تعذّر توليد صورة الشارت.",
          reason: "chart_render_failed",
          detail: "لا تتوفر شموع كافية أو فشل التصيير.",
          recommendation_id: recId,
          chart_image_url: rec.chart_image_url ?? null,
          hint:
            "توصية قديمة بدون صورة محفوظة — استخدم capture_chart_snapshot بالرمز الحالي.",
        },
        { status: 503 },
      );
    }

    const asJson =
      req.nextUrl.searchParams.get("format") === "json" ||
      req.nextUrl.searchParams.get("response_format") === "json";
    if (asJson) {
      return NextResponse.json({
        ok: true,
        recommendation_id: recId,
        symbol: rec.symbol,
        content_type: "image/png",
        image_base64: buffer.toString("base64"),
      });
    }

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
