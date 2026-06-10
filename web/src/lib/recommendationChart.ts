import { buildChartSnapshotUrl } from "./chartSnapshot";
import { overlaysFromRecommendation } from "./chartOverlays";
import type { ChartDrawing } from "./chartDrawings";
import { getSettings, updateRecommendationChartUrl } from "./store";
import { notifyUser, notifyUserPhoto, recommendationCard } from "./telegram";
import type { Recommendation } from "./types";

export interface AttachChartOptions {
  /** Send Telegram notification (advisory mode). Auto mode defers to tradeFlow. */
  notifyTelegram?: boolean;
  drawings?: ChartDrawing[];
}

/**
 * Builds a chart screenshot URL, persists it on the recommendation, and
 * optionally notifies the user on Telegram.
 */
export async function attachChartToRecommendation(
  userId: number,
  rec: Recommendation,
  options: AttachChartOptions = {},
): Promise<Recommendation> {
  if (rec.action === "wait") return rec;

  const timeframe = rec.timeframe ?? "1h";
  const overlays = overlaysFromRecommendation(rec);
  const chartUrl = await buildChartSnapshotUrl({
    symbol: rec.symbol,
    interval: timeframe,
    overlays,
    drawings: options.drawings,
    patternName: rec.pattern_name,
  });
  if (!chartUrl) return rec;

  await updateRecommendationChartUrl(rec.id, chartUrl);
  const enriched: Recommendation = { ...rec, chart_image_url: chartUrl };

  if (options.notifyTelegram) {
    const settings = await getSettings(userId);
    if (settings.telegram_chat_id) {
      const caption = recommendationCard(enriched);
      if (settings.send_screenshot === 1) {
        await notifyUserPhoto(userId, chartUrl, caption);
      } else {
        await notifyUser(userId, caption);
      }
    }
  }

  return enriched;
}

/** Resolves chart URL from recommendation metadata or builds a fresh one. */
export async function resolveChartUrl(
  rec: Pick<
    Recommendation,
    | "symbol"
    | "timeframe"
    | "chart_image_url"
    | "entry"
    | "stop_loss"
    | "take_profit"
    | "pattern_name"
    | "chart_drawings_json"
  >,
): Promise<string | null> {
  if (rec.chart_image_url) return rec.chart_image_url;
  const { parseChartDrawingsJson } = await import("./chartDrawings");
  return buildChartSnapshotUrl({
    symbol: rec.symbol,
    interval: rec.timeframe ?? "1h",
    overlays: overlaysFromRecommendation(rec as Recommendation),
    drawings: parseChartDrawingsJson(rec.chart_drawings_json),
    patternName: rec.pattern_name,
  });
}
