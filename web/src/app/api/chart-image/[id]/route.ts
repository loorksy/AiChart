import { NextRequest, NextResponse } from "next/server";
import { requireUser, handleError } from "@/lib/api";
import { getRecommendation } from "@/lib/store";
import { buildChartSnapshotBuffer } from "@/lib/chartSnapshot";
import { overlaysFromRecommendation } from "@/lib/chartOverlays";
import { parseChartDrawingsJson } from "@/lib/chartDrawings";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const recId = Number(id);
    if (!Number.isFinite(recId) || recId <= 0) {
      return NextResponse.json({ error: "معرّف غير صالح." }, { status: 400 });
    }

    const rec = await getRecommendation(recId);
    if (!rec || rec.user_id !== user.id) {
      return NextResponse.json({ error: "غير موجود." }, { status: 404 });
    }

    const buffer = await buildChartSnapshotBuffer({
      symbol: rec.symbol,
      interval: rec.timeframe ?? "1h",
      overlays: overlaysFromRecommendation(rec),
      drawings: parseChartDrawingsJson(rec.chart_drawings_json),
      patternName: rec.pattern_name,
    });

    if (!buffer) {
      return NextResponse.json(
        { error: "تعذّر توليد صورة الشارت." },
        { status: 503 },
      );
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
