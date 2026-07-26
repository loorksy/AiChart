import {
  buildChartSnapshotBufferForMarket,
  chartImagePathForRecommendation,
} from "./chartSnapshot";
import { DEFAULT_MARKET } from "./marketPolicy";
import { overlaysFromRecommendation } from "./chartOverlays";
import type { ChartDrawing } from "./chartDrawings";
import { parseChartDrawingsJson } from "./chartDrawings";
import { getSettings, updateRecommendationChartUrl } from "./store";
import { buildAccountProfile } from "./accountProfile";
import { recommendationCard } from "./telegramCards";
import { dispatchAlert, type DeliveryResult } from "./alerts";
import { claimLifecycleDedupeKey } from "./recommendations/lifecycleNotifier";
import { FEATURES } from "./agent/featureFlags";
import type { Recommendation } from "./types";
import type { InlineButton } from "./telegram";
import type { MarketType } from "./markets/types";

export interface AttachChartOptions {
  /** Send Telegram + web alert after attaching chart. */
  notify?: boolean;
  drawings?: ChartDrawing[];
  buttons?: InlineButton[][];
}

export interface NotifyRecommendationOptions {
  buttons?: InlineButton[][];
  drawings?: ChartDrawing[];
}

/**
 * Builds chart image, persists URL on recommendation, optionally notifies user.
 * Only sets chart_image_url when PNG generation succeeds (avoids broken img tags).
 */
export async function attachChartToRecommendation(
  userId: number,
  rec: Recommendation,
  options: AttachChartOptions = {},
): Promise<{ rec: Recommendation; delivery?: DeliveryResult }> {
  if (rec.action === "wait") return { rec };

  const settings = await getSettings(userId);
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

  let delivery: DeliveryResult | undefined;
  if (options.notify) {
    delivery = await notifyRecommendation(userId, enriched, {
      buttons: options.buttons,
      drawings,
    });
  }

  return { rec: enriched, delivery };
}

/**
 * Unified notification: Telegram (photo buffer) + in-app alert with image URL.
 */
export async function notifyRecommendation(
  userId: number,
  rec: Recommendation,
  options: NotifyRecommendationOptions = {},
): Promise<DeliveryResult> {
  if (rec.action === "wait") {
    return { delivered: false, reason: "no_actionable_signal" };
  }

  // Creation is announced through the lifecycle notifier's (recommendation,
  // event, revision) dedupe (plan §8 C.1). This legacy path predates that and
  // used to fire unconditionally; now it claims the SAME key the lifecycle
  // `opportunity_created` event uses — whoever speaks first wins, the other
  // stays silent. Gated so the OFF-flag behaviour is exactly today's: with
  // lifecycle alerts rolled back, this path announces as it always has.
  if (FEATURES.recLifecycleAlertsV1()) {
    const referenceId =
      (rec as { legacy_tracking_id?: string | null }).legacy_tracking_id ??
      String(rec.id);
    const claimed = await claimLifecycleDedupeKey({
      userId,
      dedupeKey: `${referenceId}:1:opportunity_created`,
      eventType: "opportunity_created",
      symbol: rec.symbol,
    });
    if (!claimed) {
      return { delivered: false, reason: "duplicate_creation_alert" };
    }
  }

  const settings = await getSettings(userId);
  const profile = await buildAccountProfile(userId, rec.symbol);
  const caption = recommendationCard({
    symbol: rec.symbol,
    action: rec.action,
    confidence: rec.confidence,
    entry: rec.entry,
    stop_loss: rec.stop_loss,
    take_profit: rec.take_profit,
    profile,
  });

  const imageUrl = rec.chart_image_url;

  return dispatchAlert(userId, {
    type: "signal",
    title: `توصية ${rec.action === "buy" ? "شراء" : "بيع"} ${rec.symbol}`,
    text: caption,
    symbol: rec.symbol,
    photoUrl: settings.send_screenshot === 1 ? imageUrl : null,
    buttons: options.buttons,
  });
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
  return null;
}
