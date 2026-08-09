import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getSettings } from "@/lib/store";
import { buildChartSnapshotBufferForMarket } from "@/lib/chartSnapshot";
import { validateChartDrawings, type ChartDrawing } from "@/lib/chartDrawings";
import { profileForInterval } from "@/lib/analysisProfile";
import { DEFAULT_MARKET, rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import { capturePlatformChart } from "@/lib/chart/platformChartCapture";

const schema = z.object({
  symbol: z.string().min(1),
  interval: z.string().default("1h"),
  market: z.string().optional(),
  pattern_name: z.string().nullish(),
  chart_drawings: z.array(z.record(z.string(), z.unknown())).optional(),
  /** Open a specific saved layout instead of the user's default chart. */
  layout_id: z.string().optional(),
  /** json = base64 PNG for MCP; png = raw image (default for curl). */
  response_format: z.enum(["json", "png"]).optional().default("json"),
});

/**
 * Bridge: ad-hoc annotated chart PNG for any symbol — for "show me the chart"
 * requests and open-trade follow-ups, without recording a recommendation.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());

    const settings = await getSettings(userId);
    const marketErr = rejectNonForexMarket(body.market);
    if (marketErr) {
      return NextResponse.json({ error: marketErr }, { status: 400 });
    }
    const market = resolveActiveMarket(body.market ?? DEFAULT_MARKET);

    const drawings = validateChartDrawings(
      (body.chart_drawings ?? []) as unknown as ChartDrawing[],
      "wait",
      100,
      profileForInterval(body.interval),
    );

    // Source order is deliberate: the PLATFORM chart first — that is the
    // chart the operator is looking at, drawings and all. QuickChart is a
    // last-resort redraw when the platform chart cannot be produced.
    const platform = await capturePlatformChart({
      userId,
      symbol: body.symbol.toUpperCase(),
      interval: body.interval,
      layoutId: body.layout_id,
    });
    if (platform) {
      if (body.response_format === "json") {
        return NextResponse.json({
          ok: true,
          content_type: "image/png",
          image_source: "platform_chart",
          image_base64: platform.buffer.toString("base64"),
        });
      }
      return new NextResponse(new Uint8Array(platform.buffer), {
        headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
      });
    }

    const buffer = await buildChartSnapshotBufferForMarket(
      userId,
      body.symbol.toUpperCase(),
      body.interval,
      market,
      {
        drawings,
        patternName: body.pattern_name ?? null,
      },
    );

    if (!buffer) {
      return NextResponse.json(
        { error: "تعذّر توليد صورة الشارت." },
        { status: 503 },
      );
    }

    if (body.response_format === "json") {
      return NextResponse.json({
        ok: true,
        content_type: "image/png",
        image_base64: buffer.toString("base64"),
      });
    }

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
