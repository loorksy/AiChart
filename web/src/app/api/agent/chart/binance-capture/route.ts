import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAgentAuth, resolveAgentUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { captureBinanceChart } from "@/lib/binanceChartCapture";
import { validateChartDrawings, type ChartDrawing } from "@/lib/chartDrawings";
import { profileForInterval } from "@/lib/analysisProfile";
import { putChartCapture } from "@/lib/chartCaptureStore";
import { getPublicAppUrl } from "@/lib/appUrl";

const schema = z.object({
  symbol: z.string().min(1),
  interval: z.string().default("1h"),
  market_type: z.enum(["spot", "futures"]).optional(),
  full_page: z.boolean().optional(),
  chart_drawings: z.array(z.record(z.string(), z.unknown())).optional(),
});

/**
 * Bridge: Binance.com chart PNG via Playwright (when enabled), else chartSnapshot.
 */
export async function POST(req: NextRequest) {
  try {
    requireAgentAuth(req);
    const userId = await resolveAgentUserId();
    const body = schema.parse(await req.json());

    const drawings = validateChartDrawings(
      (body.chart_drawings ?? []) as unknown as ChartDrawing[],
      "wait",
      100,
      profileForInterval(body.interval),
    );

    const result = await captureBinanceChart({
      symbol: body.symbol,
      interval: body.interval,
      market_type: body.market_type,
      full_page: body.full_page,
      chart_drawings: drawings,
      userId,
    });

    if (!result) {
      return NextResponse.json(
        { error: "تعذّر التقاط شارت Binance." },
        { status: 503 },
      );
    }

    const captureKey = putChartCapture(result.buffer);
    const chartPath = `/api/agent/chart/capture/${captureKey}`;
    const publicBase = getPublicAppUrl();

    return NextResponse.json({
      ok: true,
      source: result.source,
      image_base64: result.buffer.toString("base64"),
      content_type: "image/png",
      chart_url: chartPath,
      /** Use this for Telegram MEDIA — never localhost / never GET binance-capture directly. */
      chart_url_public: `${publicBase}${chartPath}`,
      media_hint:
        "Telegram: MEDIA:<chart_url_public>?token=$AICHART_SERVICE_TOKEN — or send image_base64 via message attachment.",
    });
  } catch (e) {
    return handleError(e);
  }
}
