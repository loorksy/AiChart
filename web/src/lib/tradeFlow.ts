import {
  getSettings,
  getLimits,
  createIntent,
} from "./store";
import { DEFAULT_MARKET } from "./marketPolicy";
import { planOrderFromRecommendation } from "./orderPlan";
import { executeIntent } from "./execution";
import { buildAccountProfile } from "./accountProfile";
import { buildApprovalButtonsForIntent } from "./approvalFlow";
import { approvalCard } from "./telegramCards";
import { notifyTradeResult } from "./notifyTrade";
import { dispatchAlert } from "./alerts";
import { resolveChartUrl } from "./recommendationChart";
import { committeeBlocksAuto } from "./committee";
import type { Recommendation } from "./types";
import type { MarketType } from "./markets/types";

export interface ProcessedIntent {
  id: number;
  symbol: string;
  side: string;
  notional: number;
  status: string;
  reason?: string;
  entry?: number | null;
  order_type?: "market" | "limit";
  limit_price?: number | null;
  telegramDelivered?: boolean;
  telegramReasonAr?: string;
}

function richRationale(rec: Recommendation): string {
  let factorsList: string[] = [];
  try {
    factorsList = rec.factors ? (JSON.parse(rec.factors) as string[]) : [];
  } catch {
    factorsList = [];
  }
  return [rec.rationale ?? "", ...factorsList.map((f) => `• ${f}`)]
    .filter(Boolean)
    .join("\n");
}

export interface ProcessRecommendationsOptions {
  /** Telegram agent: send approve/reject even in advisory mode. */
  allowAdvisoryApproval?: boolean;
  /** Market the recommendations belong to (selects the broker). */
  market?: MarketType;
}

/**
 * Turns agent recommendations into trade intents (and optionally executes).
 * Shared by chat, Telegram, and the 24/7 monitor cron.
 */
export async function processRecommendations(
  userId: number,
  recommendations: Recommendation[],
  options?: ProcessRecommendationsOptions,
): Promise<ProcessedIntent[]> {
  const settings = await getSettings(userId);
  const limits = await getLimits(userId);
  const intents: ProcessedIntent[] = [];

  if (limits.can_execute !== 1) return intents;

  // direct: the operator drives — recommendations never become intents here.
  if (settings.mode === "direct") return intents;

  const approvalFlow = Boolean(options?.allowAdvisoryApproval);
  if (settings.mode === "approval" && !approvalFlow) return intents;

  const autoExecute = settings.mode === "auto";

  const market = options?.market ?? settings.active_market ?? DEFAULT_MARKET;

  const effectiveCapital =
    limits.max_capital_cap > 0
      ? Math.min(settings.max_capital, limits.max_capital_cap)
      : settings.max_capital;
  const perTrade = (effectiveCapital * settings.per_trade_pct) / 100;

  for (const rec of recommendations) {
    if (rec.action !== "buy" && rec.action !== "sell") continue;

    if (autoExecute && committeeBlocksAuto(rec)) {
      intents.push({
        id: 0,
        symbol: rec.symbol,
        side: rec.action,
        notional: perTrade,
        status: "rejected",
        reason: "رفضت لجنة المخاطر (veto) — لا تنفيذ تلقائي.",
      });
      continue;
    }

    const orderPlan = planOrderFromRecommendation(rec);

    const intent = await createIntent(userId, {
      recommendation_id: rec.id,
      symbol: rec.symbol,
      side: rec.action,
      notional: perTrade,
      market,
      entry: orderPlan.entry ?? rec.entry,
      stop_loss: rec.stop_loss,
      take_profit: rec.take_profit,
      confidence: rec.confidence,
      rationale: richRationale(rec) || rec.rationale,
      status: autoExecute ? "approved" : "pending",
      order_type: orderPlan.order_type,
      limit_price: orderPlan.limit_price,
    });

    if (autoExecute) {
      const exec = await executeIntent(userId, intent.id);
      intents.push({
        id: intent.id,
        symbol: intent.symbol,
        side: intent.side,
        notional: intent.notional,
        status: exec.status,
        reason: exec.reason,
        entry: intent.entry,
        order_type: intent.order_type,
        limit_price: intent.limit_price,
      });

      await notifyTradeResult(
        userId,
        exec,
        intent.symbol,
        rec.timeframe ?? "1h",
        rec.chart_image_url,
      );
    } else {
      const profile = await buildAccountProfile(userId, intent.symbol);
      const caption = approvalCard({
        symbol: intent.symbol,
        side: intent.side,
        notional: intent.notional,
        confidence: intent.confidence,
        entry: intent.entry,
        stop_loss: intent.stop_loss,
        take_profit: intent.take_profit,
        profile,
        style: settings.style,
      });
      const chartUrl =
        settings.send_screenshot === 1 ? await resolveChartUrl(rec) : null;
      const delivery = await dispatchAlert(userId, {
        type: "signal",
        title: `إشارة ${intent.side === "buy" ? "شراء" : "بيع"} ${intent.symbol}`,
        text: caption,
        symbol: intent.symbol,
        confidence: rec.confidence,
        photoUrl: chartUrl,
        buttons: buildApprovalButtonsForIntent(intent.id, "trade"),
      });
      intents.push({
        id: intent.id,
        symbol: intent.symbol,
        side: intent.side,
        notional: intent.notional,
        status: "pending",
        entry: intent.entry,
        order_type: intent.order_type,
        limit_price: intent.limit_price,
        telegramDelivered: delivery.delivered,
        telegramReasonAr: delivery.reasonAr,
      });
    }
  }

  return intents;
}
