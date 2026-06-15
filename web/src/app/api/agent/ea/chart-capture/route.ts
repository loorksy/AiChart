import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAgentAuth, resolveAgentUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { queueMt5ChartCapture } from "@/lib/eaChartDraw";
import type { ChartDrawing } from "@/lib/chartDrawings";

const drawingSchema = z.record(z.string(), z.unknown());

const schema = z.object({
  symbol: z.string().min(1),
  interval: z.string().default("1h"),
  recommendation_id: z.number().int().positive().optional(),
  capture_key: z.string().optional(),
  entry: z.number().optional(),
  stop_loss: z.number().optional(),
  take_profit: z.number().optional(),
  drawings: z.array(drawingSchema).default([]),
});

/** Bridge: draw on MT5 chart + screenshot (EA draw_and_capture). */
export async function POST(req: NextRequest) {
  try {
    requireAgentAuth(req);
    const userId = await resolveAgentUserId();
    const body = schema.parse(await req.json());

    const result = await queueMt5ChartCapture(userId, {
      symbol: body.symbol,
      interval: body.interval,
      recommendationId: body.recommendation_id,
      captureKey: body.capture_key,
      entry: body.entry,
      stop_loss: body.stop_loss,
      take_profit: body.take_profit,
      drawings: body.drawings as unknown as ChartDrawing[],
    });

    return NextResponse.json(result);
  } catch (e) {
    return handleError(e);
  }
}
