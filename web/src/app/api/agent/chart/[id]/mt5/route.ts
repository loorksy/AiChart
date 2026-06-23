import { NextRequest, NextResponse } from "next/server";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import {
  captureKeyForRecommendation,
  getPendingChartCapture,
  isEaChartFileReady,
  isEaOnline,
  readEaChartPng,
} from "@/lib/eaChartDraw";
import { getRecommendation } from "@/lib/store";

/**
 * Bridge: MT5-native chart PNG for a recommendation (or snap_* capture key).
 * 202 while EA is drawing; 200 when PNG is ready; 503 if EA is offline.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await resolveBridgeUserId(req);
    const { id } = await ctx.params;
    const recId = Number(id);
    const isNumeric = Number.isFinite(recId) && recId > 0;
    const captureKey = isNumeric ? captureKeyForRecommendation(recId) : id;

    if (!isNumeric && !id.startsWith("snap_")) {
      return NextResponse.json({ error: "معرّف غير صالح." }, { status: 400 });
    }

    if (isNumeric) {
      const rec = await getRecommendation(recId, userId);
      if (!rec || rec.user_id !== userId) {
        return NextResponse.json({ error: "غير موجود." }, { status: 404 });
      }
    }

    if (!(await isEaOnline(userId))) {
      return NextResponse.json(
        { status: "offline", error: "MetaTrader EA غير متصل." },
        { status: 503 },
      );
    }

    if (isEaChartFileReady(userId, captureKey)) {
      const buffer = await readEaChartPng(userId, captureKey);
      if (buffer) {
        return new NextResponse(new Uint8Array(buffer), {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "private, max-age=60",
          },
        });
      }
    }

    const pending = await getPendingChartCapture(userId, captureKey);
    if (pending) {
      return NextResponse.json(
        { status: "pending", message: "في انتظار لقطة شارت MT5." },
        { status: 202 },
      );
    }

    return NextResponse.json(
      { status: "pending", message: "لم تُرفع اللقطة بعد." },
      { status: 202 },
    );
  } catch (e) {
    return handleError(e);
  }
}
