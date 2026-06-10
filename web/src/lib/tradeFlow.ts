import {
  getSettings,
  getLimits,
  createIntent,
} from "./store";
import { executeIntent } from "./execution";
import {
  approvalCard,
  APPROVE_BUTTON_TEXT,
  REJECT_BUTTON_TEXT,
} from "./telegram";
import { notifyTradeResult } from "./notifyTrade";
import { dispatchAlert } from "./alerts";
import { resolveChartUrl } from "./recommendationChart";
import type { Recommendation } from "./types";
import type { MarketType } from "./markets/types";

export interface ProcessedIntent {
  id: number;
  symbol: string;
  side: string;
  notional: number;
  status: string;
  reason?: string;
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

  const advisoryApproval = Boolean(options?.allowAdvisoryApproval);
  if (settings.mode !== "auto" && !advisoryApproval) return intents;

  const autoExecute =
    settings.mode === "auto" && settings.approval === "delegate";

  const market = options?.market ?? settings.active_market ?? "crypto";

  const effectiveCapital =
    limits.max_capital_cap > 0
      ? Math.min(settings.max_capital, limits.max_capital_cap)
      : settings.max_capital;
  const perTrade = (effectiveCapital * settings.per_trade_pct) / 100;

  for (const rec of recommendations) {
    if (rec.action !== "buy" && rec.action !== "sell") continue;

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
      intents.push({
        id: intent.id,
        symbol: intent.symbol,
        side: intent.side,
        notional: intent.notional,
        status: "pending",
      });
      const caption = approvalCard({
        ...intent,
        pattern_name: rec.pattern_name,
        timeframe: rec.timeframe,
      });
      const buttons = [
        [
          { text: APPROVE_BUTTON_TEXT, callback_data: `approve:${intent.id}` },
          { text: REJECT_BUTTON_TEXT, callback_data: `reject:${intent.id}` },
        ],
      ];
      const chartUrl =
        settings.send_screenshot === 1 ? await resolveChartUrl(rec) : null;
      await dispatchAlert(userId, {
        type: "signal",
        title: `إشارة ${intent.side === "buy" ? "شراء" : "بيع"} ${intent.symbol}`,
        text: caption,
        symbol: intent.symbol,
        confidence: rec.confidence,
        photoUrl: chartUrl,
        buttons,
      });
    }
  }

  return intents;
}
