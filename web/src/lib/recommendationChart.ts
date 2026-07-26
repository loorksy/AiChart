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
import { announceOpportunityCreated } from "./recommendations/lifecycleNotifier";
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
 * Creation notification for a recommendation.
 *
 * When lifecycle alerts are on (plan §8 C.1), this is a thin adapter over
 * `announceOpportunityCreated` — the only legal producer of
 * `opportunity_created`. It never claims a dedupe key or calls `dispatchAlert`
 * itself for creation; that kept a parallel path alive and made retries race.
 *
 * When the flag is off, the pre-lifecycle Telegram+in-app card is kept so a
 * rollback restores today's behaviour without losing the chart caption.
 */
export async function notifyRecommendation(
  userId: number,
  rec: Recommendation,
  options: NotifyRecommendationOptions = {},
): Promise<DeliveryResult> {
  if (rec.action === "wait") {
    return { delivered: false, reason: "no_actionable_signal" };
  }
  if (rec.action !== "buy" && rec.action !== "sell") {
    return { delivered: false, reason: "no_actionable_signal" };
  }

  if (FEATURES.recLifecycleAlertsV1()) {
    const referenceId =
      (rec as { legacy_tracking_id?: string | null }).legacy_tracking_id ??
      String(rec.id);
    const announced = await announceOpportunityCreated(userId, {
      recommendationId: referenceId,
      symbol: rec.symbol,
      direction: rec.action,
      entry: rec.entry,
      planType: (rec as { plan_type?: string | null }).plan_type ?? null,
    });
    if (announced.delivered > 0) return { delivered: true };
    if (announced.suppressedDuplicate > 0) {
      return { delivered: false, reason: "duplicate_creation_alert" };
    }
    if (announced.suppressedSilent > 0) {
      return { delivered: false, reason: "silent_mode" };
    }
    if (announced.suppressedRateLimit > 0) {
      return { delivered: false, reason: "rate_limited" };
    }
    return { delivered: false, reason: "delivery_failed" };
  }

  // Flag OFF — keep the legacy card so rollback is behaviour-identical.
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

  return dispatchAlert(userId, {
    type: "signal",
    title: `توصية ${rec.action === "buy" ? "شراء" : "بيع"} ${rec.symbol}`,
    text: caption,
    symbol: rec.symbol,
    photoUrl: settings.send_screenshot === 1 ? rec.chart_image_url : null,
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
