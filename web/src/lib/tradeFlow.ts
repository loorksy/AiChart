import {
  getSettings,
  getLimits,
  createIntent,
} from "./store";
import { executeIntent } from "./execution";
import { approvalCard } from "./telegram";
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

  const market = options?.market ?? settings.active_market ?? "crypto";

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

    const intent = await createIntent(userId, {
      recommendation_id: rec.id,
      symbol: rec.symbol,
      side: rec.action,
      notional: perTrade,
      market,
      entry: rec.entry,
      stop_loss: rec.stop_loss,
      take_profit: rec.take_profit,
      confidence: rec.confidence,
      rationale: richRationale(rec) || rec.rationale,
      status: autoExecute ? "approved" : "pending",
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
      });

      await notifyTradeResult(
        userId,
        exec,
        intent.symbol,
        rec.timeframe ?? "1h",
        rec.chart_image_url,
      );
    } else {
      const caption = approvalCard({
        ...intent,
        pattern_name: rec.pattern_name,
        timeframe: rec.timeframe,
      });
      // Approval happens on the dashboard or via the OpenClaw agent chat —
      // inline callback buttons are gone with the old webhook bot.
      const chartUrl =
        settings.send_screenshot === 1 ? await resolveChartUrl(rec) : null;
      const delivery = await dispatchAlert(userId, {
        type: "signal",
        title: `إشارة ${intent.side === "buy" ? "شراء" : "بيع"} ${intent.symbol}`,
        text: caption,
        symbol: intent.symbol,
        confidence: rec.confidence,
        photoUrl: chartUrl,
      });
      intents.push({
        id: intent.id,
        symbol: intent.symbol,
        side: intent.side,
        notional: intent.notional,
        status: "pending",
        telegramDelivered: delivery.delivered,
        telegramReasonAr: delivery.reasonAr,
      });
    }
  }

  return intents;
}
