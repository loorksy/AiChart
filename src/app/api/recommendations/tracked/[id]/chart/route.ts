import { NextRequest, NextResponse } from "next/server";
import { requirePaidAccess, handleError, ApiError } from "@/lib/api";
import { DEFAULT_MARKET } from "@/lib/marketPolicy";
import { getTrackedRecommendation } from "@/lib/recommendations/recommendationStore";
import { buildChartSnapshotBufferForMarket } from "@/lib/chartSnapshot";
import { parseChartDrawingsJson } from "@/lib/chartDrawings";
import { overlaysFromRecommendation } from "@/lib/chartOverlays";
import type { Recommendation } from "@/lib/types";

/**
 * The recommendation's chart snapshot for the DETAIL PAGE: the plan's own
 * levels (entry, stop, targets) and its stored drawings, rendered server-side
 * over platform candles. Cookie-auth twin of the bridge route
 * (/api/agent/chart/[id]) — same renderer, owner-scoped, PNG out, and a plain
 * 404/503 the <img> handler can hide gracefully. Read-only: nothing here
 * sweeps or mutates the plan.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePaidAccess();
    const { id } = await ctx.params;
    const rec = await getTrackedRecommendation(user.id, id);
    if (!rec) throw new ApiError(404, "Recommendation not found.");

    // The canonical level labels live in chartOverlays.ts — reuse them via a
    // minimal legacy-shaped record rather than restating the strings here.
    const overlays = overlaysFromRecommendation(
      {
        entry: rec.entry,
        stop_loss: rec.stopLoss,
        take_profit: rec.targets[0] ?? null,
      } as Recommendation,
      rec.targets.slice(0, 3),
    );

    const buffer = await buildChartSnapshotBufferForMarket(
      user.id,
      rec.symbol,
      rec.interval,
      DEFAULT_MARKET,
      {
        overlays,
        drawings: parseChartDrawingsJson(rec.chartDrawingsJson),
      },
    );

    if (!buffer) {
      // No candles or render failure — the page hides the section, it does
      // not fabricate a chart. The <img> handler only reads the status code.
      return NextResponse.json({ error: "chart_render_failed" }, { status: 503 });
    }

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
