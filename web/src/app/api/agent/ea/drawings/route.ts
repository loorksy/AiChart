import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess } from "@/lib/api";
import {
  queueApplyChartDrawingsToMt5,
  queueClearAiChartDrawingsFromMt5,
} from "@/lib/chart/mt5DrawingQueue";
import type { ChartDrawing } from "@/lib/chartDrawings";

const drawingPointSchema = z.object({
  time: z.number().optional().nullable(),
  price: z.number(),
  barsAhead: z.number().optional().nullable(),
});

const drawingSchema = z.object({
  type: z.string(),
  confidence: z.number().optional().default(70),
  label: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  semanticRole: z.string().optional().nullable(),
  patternType: z.string().optional().nullable(),
  points: z.array(drawingPointSchema).optional().default([]),
  price: z.number().optional().nullable(),
  price2: z.number().optional().nullable(),
  price3: z.number().optional().nullable(),
  style: z.enum(["solid", "dashed", "dotted"]).optional(),
  width: z.number().optional(),
  fill: z.boolean().optional(),
  fill_color: z.string().optional().nullable(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("apply"),
    symbol: z.string().min(2),
    timeframe: z.string().min(2),
    drawings: z.array(drawingSchema),
    replaceExisting: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("clear"),
    symbol: z.string().min(2),
    timeframe: z.string().optional().nullable(),
  }),
]);

export async function POST(req: NextRequest) {
  const user = await requirePlatformAccess();
  const body = schema.parse(await req.json());

  if (body.action === "clear") {
    const command = await queueClearAiChartDrawingsFromMt5(user.id, {
      symbol: body.symbol,
      timeframe: body.timeframe,
    });
    return NextResponse.json({ ok: true, commandId: command.id });
  }

  const result = await queueApplyChartDrawingsToMt5(user.id, {
    symbol: body.symbol,
    timeframe: body.timeframe,
    drawings: body.drawings as ChartDrawing[],
    replaceExisting: body.replaceExisting,
  });

  return NextResponse.json({
    ok: result.queued,
    commandId: result.command?.id ?? null,
    count: result.count,
    reason: result.reason,
  });
}
