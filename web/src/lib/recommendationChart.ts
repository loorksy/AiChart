import {
  buildChartSnapshotBuffer,
  buildChartSnapshotUrl,
  chartImagePathForRecommendation,
} from "./chartSnapshot";
import { overlaysFromRecommendation } from "./chartOverlays";
import type { ChartDrawing } from "./chartDrawings";
import { parseChartDrawingsJson } from "./chartDrawings";
import { getSettings, updateRecommendationChartUrl } from "./store";
import { recommendationCard } from "./telegram";
import { dispatchAlert } from "./alerts";
import type { Recommendation } from "./types";
import type { InlineButton } from "./telegram";

export interface AttachChartOptions {
  /** Send Telegram + web alert after attaching chart. */
  notify?: boolean;
  drawings?: ChartDrawing[];
  buttons?: InlineButton[][];
}

export interface NotifyRecommendationOptions {
  notifyTelegram?: boolean;
  notifyWeb?: boolean;
  buttons?: InlineButton[][];
  drawings?: ChartDrawing[];
}

/**
 * Builds chart image, persists URL on recommendation, optionally notifies user.
 */
export async function attachChartToRecommendation(
  userId: number,
  rec: Recommendation,
  options: AttachChartOptions = {},
): Promise<Recommendation> {
  if (rec.action === "wait") return rec;

  const overlays = overlaysFromRecommendation(rec);
  const drawings =
    options.drawings ?? parseChartDrawingsJson(rec.chart_drawings_json);
  const timeframe = rec.timeframe ?? "1h";

  const imagePath = chartImagePathForRecommendation(rec.id);
  await updateRecommendationChartUrl(rec.id, imagePath);
  const enriched: Recommendation = { ...rec, chart_image_url: imagePath };

  if (options.notify) {
    await notifyRecommendation(userId, enriched, {
      notifyTelegram: true,
      notifyWeb: true,
      buttons: options.buttons,
      drawings,
    });
  }

  return enriched;
}

/**
 * Unified notification: Telegram (photo buffer) + in-app alert with image URL.
 */
export async function notifyRecommendation(
  userId: number,
  rec: Recommendation,
  options: NotifyRecommendationOptions = {},
): Promise<void> {
  if (rec.action === "wait") return;

  const settings = await getSettings(userId);
  const caption = recommendationCard(rec);
  const drawings =
    options.drawings ?? parseChartDrawingsJson(rec.chart_drawings_json);
  const overlays = overlaysFromRecommendation(rec);
  const timeframe = rec.timeframe ?? "1h";

  let imageUrl = rec.chart_image_url ?? chartImagePathForRecommendation(rec.id);
  if (!rec.chart_image_url) {
    await updateRecommendationChartUrl(rec.id, imageUrl);
  }

  const photoBuffer =
    settings.send_screenshot === 1
      ? await buildChartSnapshotBuffer({
          symbol: rec.symbol,
          interval: timeframe,
          overlays,
          drawings,
          patternName: rec.pattern_name,
        })
      : null;

  if (options.notifyTelegram && settings.telegram_chat_id) {
    const { notifyUser, notifyUserPhotoBuffer } = await import("./telegram");
    if (settings.send_screenshot === 1 && photoBuffer) {
      await notifyUserPhotoBuffer(
        userId,
        photoBuffer,
        caption,
        options.buttons,
      );
    } else {
      await notifyUser(userId, caption, options.buttons);
    }
  }

  if (options.notifyWeb) {
    await dispatchAlert(userId, {
      type: "signal",
      title: `توصية ${rec.action === "buy" ? "شراء" : "بيع"} ${rec.symbol}`,
      text: caption,
      symbol: rec.symbol,
      confidence: rec.confidence,
      photoUrl: settings.send_screenshot === 1 ? imageUrl : null,
      buttons: options.buttons,
    });
  }
}

/** Resolves chart URL from recommendation metadata or builds a fresh one. */
export async function resolveChartUrl(
  rec: Pick<
    Recommendation,
    | "id"
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
  if (rec.id) return chartImagePathForRecommendation(rec.id);
  const { parseChartDrawingsJson: parseDrawings } = await import("./chartDrawings");
  return buildChartSnapshotUrl({
    symbol: rec.symbol,
    interval: rec.timeframe ?? "1h",
    overlays: overlaysFromRecommendation(rec as Recommendation),
    drawings: parseDrawings(rec.chart_drawings_json),
    patternName: rec.pattern_name,
  });
}
