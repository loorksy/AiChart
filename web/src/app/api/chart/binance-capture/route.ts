import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, handleError } from "@/lib/api";
import { captureBinanceChart } from "@/lib/binanceChartCapture";
import { validateChartDrawings, type ChartDrawing } from "@/lib/chartDrawings";
import { profileForInterval } from "@/lib/analysisProfile";

const schema = z.object({
  symbol: z.string().min(1),
  interval: z.string().default("1h"),
  market_type: z.enum(["spot", "futures"]).optional(),
  full_page: z.boolean().optional(),
  chart_drawings: z.array(z.record(z.string(), z.unknown())).optional(),
});

/** Session-authenticated Binance chart capture for the bridge console UI. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
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
      userId: user.id,
    });

    if (!result) {
      return NextResponse.json(
        { error: "تعذّر التقاط شارت Binance." },
        { status: 503 },
      );
    }

    return new NextResponse(new Uint8Array(result.buffer), {
      headers: {
        "Content-Type": "image/png",
        "X-Chart-Source": result.source,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
