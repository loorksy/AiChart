import { NextRequest, NextResponse } from "next/server";
import { handleError } from "@/lib/api";
import { requireEaConnection } from "@/lib/eaAuth";
import {
  captureKeyForRecommendation,
  mt5ChartUrl,
  writeEaChartPng,
} from "@/lib/eaChartDraw";
import { getRecommendation, updateRecommendationChartUrl } from "@/lib/store";

/**
 * EA → server: multipart PNG upload after ChartScreenShot + draw_and_capture.
 */
export async function POST(req: NextRequest) {
  try {
    const conn = await requireEaConnection(req);
    const form = await req.formData();

    const recIdRaw = form.get("recommendation_id");
    const captureKeyRaw = form.get("capture_key");
    const file = form.get("chart");

    const recommendationId =
      recIdRaw != null && String(recIdRaw).trim() !== ""
        ? Number(recIdRaw)
        : 0;
    const captureKey =
      captureKeyRaw != null && String(captureKeyRaw).trim() !== ""
        ? String(captureKeyRaw).trim()
        : recommendationId > 0
          ? captureKeyForRecommendation(recommendationId)
          : null;

    if (!captureKey) {
      return NextResponse.json(
        { error: "recommendation_id or capture_key is required." },
        { status: 400 },
      );
    }

    if (!(file instanceof Blob) || file.size === 0) {
      return NextResponse.json({ error: "chart PNG file is required." }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length < 100 || bytes[0] !== 0x89) {
      return NextResponse.json({ error: "Invalid PNG payload." }, { status: 400 });
    }

    const storedPath = await writeEaChartPng(conn.user_id, captureKey, bytes);

    if (recommendationId > 0) {
      const rec = await getRecommendation(recommendationId);
      if (rec && rec.user_id === conn.user_id) {
        await updateRecommendationChartUrl(
          recommendationId,
          mt5ChartUrl(recommendationId),
        );
      }
    }

    return NextResponse.json({
      ok: true,
      path: storedPath,
      chart_url:
        recommendationId > 0
          ? mt5ChartUrl(recommendationId)
          : mt5ChartUrl(captureKey),
    });
  } catch (err) {
    return handleError(err);
  }
}
