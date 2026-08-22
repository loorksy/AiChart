import {
  buildChartSnapshotBufferForMarket,
  chartImagePathForRecommendation,
} from "./chartSnapshot";
import { DEFAULT_MARKET } from "./marketPolicy";
import { overlaysFromRecommendation } from "./chartOverlays";
import type { ChartDrawing } from "./chartDrawings";
import { parseChartDrawingsJson } from "./chartDrawings";
import { updateRecommendationChartUrl } from "./store";
import type { Recommendation } from "./types";
import type { MarketType } from "./markets/types";

export interface AttachChartOptions {
  drawings?: ChartDrawing[];
}

/**
 * Builds the chart image and persists its URL on the recommendation.
 * Only sets chart_image_url when PNG generation succeeds (avoids broken img
 * tags). The platform sends no notifications — the chart exists for the
 * report page and the agent's own replies.
 */
export async function attachChartToRecommendation(
  userId: number,
  rec: Recommendation,
  options: AttachChartOptions = {},
): Promise<{ rec: Recommendation }> {
  if (rec.action === "wait") return { rec };

  const market = (rec.market ?? DEFAULT_MARKET) as MarketType;
  const overlays = overlaysFromRecommendation(rec);
  const drawings =
    options.drawings ?? parseChartDrawingsJson(rec.chart_drawings_json);

  const buffer = await buildChartSnapshotBufferForMarket(
    userId,
    rec.symbol,
    rec.timeframe ?? "1h",
    market,
    {
      overlays,
      drawings,
      patternName: rec.pattern_name,
    },
  );

  const imagePath = buffer ? chartImagePathForRecommendation(rec.id) : null;
  await updateRecommendationChartUrl(rec.id, imagePath);
  const enriched: Recommendation = { ...rec, chart_image_url: imagePath };

  return { rec: enriched };
}
