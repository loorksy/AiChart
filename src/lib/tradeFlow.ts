import { createIntent, getLimits, getSettings, resolveBrokerForMarket } from "./store";
import { getRiskBudget } from "./execution";
import { getEffectiveRevision } from "./recommendations/canonical/revisions";
import { planOrderFromRecommendation } from "./orderPlan";
import { buildAccountProfile } from "./accountProfile";
import { buildApprovalButtonsForIntent } from "./approvalFlow";
import { approvalCard } from "./telegramCards";
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
  entry?: number | null;
  order_type?: "market" | "limit" | "stop";
  limit_price?: number | null;
  telegramDelivered?: boolean;
  telegramReasonAr?: string;
}

export interface ProcessRecommendationsOptions {
  allowAdvisoryApproval?: boolean;
  market?: MarketType;
}

function richRationale(recommendation: Recommendation): string {
  let factors: string[] = [];
  try { factors = recommendation.factors ? JSON.parse(recommendation.factors) as string[] : []; } catch { /* optional metadata */ }
  return [recommendation.rationale ?? "", ...factors.map((factor) => `• ${factor}`)].filter(Boolean).join("\n");
}

/** Converts AI recommendations into approval intents; it never changes action or size. */
export async function processRecommendations(
  userId: number,
  recommendations: Recommendation[],
  options?: ProcessRecommendationsOptions,
): Promise<ProcessedIntent[]> {
  const [settings, limits] = await Promise.all([getSettings(userId), getLimits(userId)]);
  if (!Boolean(limits.can_execute)) return [];
  const market = options?.market ?? "forex";
  const broker = await resolveBrokerForMarket(userId, market);
  const budget = await getRiskBudget(userId, broker);
  if (!budget) return [];
  const results: ProcessedIntent[] = [];

  for (const recommendation of recommendations) {
    if (recommendation.action !== "buy" && recommendation.action !== "sell") continue;
    const orderPlan = planOrderFromRecommendation(recommendation);
    // Stamp the revision these levels came from, so the execution-time CAS can
    // refuse the order if the plan is revised before the operator approves.
    const effectiveRevision = await getEffectiveRevision(userId, recommendation.id).catch(
      () => null,
    );
    const intent = await createIntent(userId, {
      recommendation_id: recommendation.id,
      recommendation_revision_no: effectiveRevision?.revisionNo ?? null,
      // Executable only through the operator approving THIS trade.
      authorization_source: "user_approved",
      symbol: recommendation.symbol,
      side: recommendation.action,
      notional: budget.riskAmount,
      market,
      broker,
      entry: orderPlan.entry ?? recommendation.entry,
      stop_loss: recommendation.stop_loss,
      take_profit: recommendation.take_profit,
      confidence: recommendation.confidence,
      rationale: richRationale(recommendation),
      status: "pending",
      order_type: orderPlan.order_type,
      limit_price: orderPlan.limit_price,
    });
    const profile = await buildAccountProfile(userId, intent.symbol);
    const caption = approvalCard({
      symbol: intent.symbol,
      side: intent.side,
      riskAmount: intent.notional,
      confidence: intent.confidence,
      entry: intent.entry,
      stop_loss: intent.stop_loss,
      take_profit: intent.take_profit,
      profile,
    });
    const delivery = await dispatchAlert(userId, {
      type: "signal",
      title: `إشارة ${intent.side === "buy" ? "شراء" : "بيع"} ${intent.symbol}`,
      text: caption,
      symbol: intent.symbol,
      photoUrl: settings.send_screenshot === 1 ? await resolveChartUrl(recommendation) : null,
      buttons: buildApprovalButtonsForIntent(intent.id, "trade"),
    });
    results.push({
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
  return results;
}
