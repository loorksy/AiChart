import {
  getSettings,
  getLimits,
  createIntent,
} from "./store";
import { executeIntent } from "./execution";
import {
  notifyUser,
  approvalCard,
  APPROVE_BUTTON_TEXT,
  REJECT_BUTTON_TEXT,
} from "./telegram";
import { notifyTradeResult } from "./notifyTrade";
import type { Recommendation } from "./types";

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

/**
 * Turns agent recommendations into trade intents (and optionally executes).
 * Shared by chat and the 24/7 monitor cron.
 */
export async function processRecommendations(
  userId: number,
  recommendations: Recommendation[],
): Promise<ProcessedIntent[]> {
  const settings = getSettings(userId);
  const limits = getLimits(userId);
  const intents: ProcessedIntent[] = [];

  if (settings.mode !== "auto" || limits.can_execute !== 1) return intents;

  const effectiveCapital =
    limits.max_capital_cap > 0
      ? Math.min(settings.max_capital, limits.max_capital_cap)
      : settings.max_capital;
  const perTrade = (effectiveCapital * settings.per_trade_pct) / 100;

  for (const rec of recommendations) {
    if (rec.action !== "buy" && rec.action !== "sell") continue;

    const delegate = settings.approval === "delegate";
    const intent = createIntent(userId, {
      recommendation_id: rec.id,
      symbol: rec.symbol,
      side: rec.action,
      notional: perTrade,
      entry: rec.entry,
      stop_loss: rec.stop_loss,
      take_profit: rec.take_profit,
      confidence: rec.confidence,
      rationale: richRationale(rec) || rec.rationale,
      status: delegate ? "approved" : "pending",
    });

    if (delegate) {
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
      );
    } else {
      intents.push({
        id: intent.id,
        symbol: intent.symbol,
        side: intent.side,
        notional: intent.notional,
        status: "pending",
      });
      await notifyUser(userId, approvalCard(intent), [
        [
          { text: APPROVE_BUTTON_TEXT, callback_data: `approve:${intent.id}` },
          { text: REJECT_BUTTON_TEXT, callback_data: `reject:${intent.id}` },
        ],
      ]);
    }
  }

  return intents;
}
