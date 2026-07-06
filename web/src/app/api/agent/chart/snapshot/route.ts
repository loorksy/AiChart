import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getSettings } from "@/lib/store";
import { buildChartSnapshotBufferForMarket } from "@/lib/chartSnapshot";
import { validateChartDrawings, type ChartDrawing } from "@/lib/chartDrawings";
import { profileForInterval } from "@/lib/analysisProfile";
import { DEFAULT_MARKET, rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import {
  canUseMt5ChartCapture,
  mt5ChartUrl,
  queueMt5ChartCapture,
} from "@/lib/eaChartDraw";

const schema = z.object({
  symbol: z.string().min(1),
  interval: z.string().default("1h"),
  market: z.string().optional(),
  pattern_name: z.string().nullish(),
  chart_drawings: z.array(z.record(z.string(), z.unknown())).optional(),
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
    const market = resolveActiveMarket(body.market ?? settings.active_market ?? DEFAULT_MARKET);

    const drawings = validateChartDrawings(
      (body.chart_drawings ?? []) as unknown as ChartDrawing[],
      "wait",
      100,
      profileForInterval(body.interval),
    );

    const mt5 = await canUseMt5ChartCapture(userId, body.symbol);
    if (mt5.ok) {
      const captureKey = `snap_${Date.now()}`;
      await queueMt5ChartCapture(userId, {
        captureKey,
        symbol: body.symbol,
        interval: body.interval,
        drawings,
      });
      return NextResponse.json(
        {
          ok: true,
          status: "pending",
          chart_url: mt5ChartUrl(captureKey),
          mt5_symbol: mt5.mt5Symbol,
        },
        { status: 202 },
      );
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
