import crypto from "crypto";
import { DEFAULT_MARKET } from "@/lib/marketPolicy";
import { buildAccountProfile } from "./accountProfile";
import { getAppSecret } from "./env";
import { getPlatformValue } from "./platformConfig";
import {
  createIntent,
  getIntent,
  getRecommendation,
  getSettings,
  resolveBrokerForMarket,
  updateIntentStatus,
} from "./store";
import { executeIntent, getRiskBudget } from "./execution";
import { getEffectiveRevision } from "./recommendations/canonical/revisions";
import { dispatchAlert } from "./alerts";
import type { InlineButton } from "./telegram";
import { resolveChartUrl } from "./recommendationChart";
import type { MarketType } from "./markets/types";
import { notifyTradeResult } from "./notifyTrade";
import {
  revalidatePendingIntent,
  shouldRevalidateBeforeApprove,
} from "./intentRevalidate";
import { approvalCard, cancelledTradeCard } from "./telegramCards";

export type ApprovalKind = "trade" | "practice";

const ACTION_TTL_MS = 30 * 60 * 1000;

function appBaseUrl(): string {
  return (
    getPlatformValue("APP_URL")?.replace(/\/$/, "") ||
    process.env.APP_URL?.replace(/\/$/, "") ||
    "https://aichart.lork.cloud"
  );
}

function signPayload(intentId: number, action: "approve" | "reject", exp: number): string {
  return crypto
    .createHmac("sha256", getAppSecret())
    .update(`${intentId}:${action}:${exp}`)
    .digest("hex");
}

/** @deprecated URL buttons — kept for legacy /api/telegram/act links. */
export function buildSignedActionUrl(
  intentId: number,
  action: "approve" | "reject",
): string {
  const exp = Date.now() + ACTION_TTL_MS;
  const sig = signPayload(intentId, action, exp);
  const base = appBaseUrl();
  return `${base}/api/telegram/act?intent=${intentId}&action=${action}&exp=${exp}&sig=${sig}`;
}

export function verifySignedAction(
  intentId: number,
  action: "approve" | "reject",
  exp: number,
  sig: string,
): boolean {
  if (!Number.isInteger(intentId) || intentId <= 0) return false;
  if (action !== "approve" && action !== "reject") return false;
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  if (!sig || sig.length < 16) return false;
  const expected = signPayload(intentId, action, exp);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(sig, "hex"),
    );
  } catch {
    return false;
  }
}

export function buildApprovalButtonsForIntent(
  intentId: number,
  kind: ApprovalKind,
): InlineButton[][] {
  const practice = kind === "practice";
  const approveLabel = practice ? "✅ تجربة" : "✅ موافق";
  return [
    [
      { text: approveLabel, callback_data: `cmd:approve:${intentId}` },
      { text: "❌ رفض", callback_data: `cmd:reject:${intentId}` },
    ],
    [
      { text: "🔄 زوج آخر", callback_data: "cmd:analyze:pick" },
      { text: "📋 القائمة", callback_data: "cmd:home" },
    ],
  ];
}

export interface ApprovalRequestInput {
  symbol: string;
  side: "buy" | "sell";
  market?: MarketType;
  entry?: number | null;
  stop_loss?: number | null;
  take_profit?: number | null;
  confidence?: number;
  rationale?: string | null;
  recommendation_id?: number | null;
  practice?: boolean;
  kind?: ApprovalKind;
  photoUrl?: string | null;
}

export async function createApprovalRequest(
  userId: number,
  input: ApprovalRequestInput,
): Promise<{ intentId: number; telegramDelivered: boolean; reasonAr?: string }> {
  const settings = await getSettings(userId);
  const market = input.market ?? DEFAULT_MARKET;
  const broker = await resolveBrokerForMarket(userId, market);
  const budget = await getRiskBudget(userId, broker);
  if (!budget) throw new Error("تعذّر التحقق من equity للحساب المتصل.");

  // The revision these levels came from, captured NOW so the execution-time
  // compare-and-swap can refuse the order if the plan moves while the approval
  // sits in the operator's inbox. Null for pre-revision recommendations.
  const revisionNo =
    input.recommendation_id != null
      ? ((await getEffectiveRevision(userId, input.recommendation_id).catch(() => null))
          ?.revisionNo ?? null)
      : null;

  const intent = await createIntent(userId, {
    recommendation_id: input.recommendation_id ?? null,
    recommendation_revision_no: revisionNo,
    // Executable only through the operator approving THIS trade — enforced at
    // the choke point, which requires `explicitApproval` for this source.
    authorization_source: "user_approved",
    symbol: input.symbol,
    side: input.side,
    notional: budget.riskAmount,
    market,
    broker,
    entry: input.entry ?? null,
    stop_loss: input.stop_loss ?? null,
    take_profit: input.take_profit ?? null,
    confidence: input.confidence ?? 0,
    rationale: input.rationale ?? null,
    status: "pending",
    practice: Boolean(input.practice),
  });

  const profile = await buildAccountProfile(userId, intent.symbol);
  const kind = input.kind ?? (input.practice ? "practice" : "trade");
  const caption = approvalCard({
    symbol: intent.symbol,
    side: intent.side,
    riskAmount: intent.notional,
    entry: intent.entry,
    stop_loss: intent.stop_loss,
    take_profit: intent.take_profit,
    confidence: input.confidence ?? 0,
    profile,
  });
  const buttons = buildApprovalButtonsForIntent(intent.id, kind);

  let photoUrl = input.photoUrl ?? null;
  if (!photoUrl && input.recommendation_id && settings.send_screenshot === 1) {
    const rec = await getRecommendation(input.recommendation_id, userId);
    if (rec) photoUrl = await resolveChartUrl(rec);
  }

  const delivery = await dispatchAlert(userId, {
    type: "signal",
    title: `طلب ${intent.side === "buy" ? "شراء" : "بيع"} ${intent.symbol}`,
    text: caption,
    symbol: intent.symbol,
    photoUrl,
    buttons,
  });

  return {
    intentId: intent.id,
    telegramDelivered: delivery.delivered,
    reasonAr: delivery.reasonAr,
  };
}

export async function respondToApproval(
  userId: number,
  intentId: number,
  action: "approve" | "reject",
): Promise<{
  ok: boolean;
  status: string;
  reason?: string;
  tradeId?: number | null;
  revalidated?: boolean;
}> {
  const intent = await getIntent(intentId, userId);
  if (!intent || intent.user_id !== userId) {
    return { ok: false, status: "not_found", reason: "الطلب غير موجود." };
  }
  if (intent.status !== "pending") {
    return {
      ok: false,
      status: intent.status,
      reason: "تمّت معالجة هذا الطلب مسبقاً.",
    };
  }

  // An SL/TP-modify proposal for an open position — never an order. Approving
  // routes to the broker's modify path; executeIntent refuses this source.
  if (intent.authorization_source === "trade_management") {
    const { respondToTradeManagementIntent } = await import(
      "./recommendations/tradeManagement"
    );
    return respondToTradeManagementIntent(userId, intent, action);
  }

  if (action === "reject") {
    await updateIntentStatus(intentId, "rejected", "رفضه المشغّل.");
    return { ok: true, status: "rejected" };
  }

  if (shouldRevalidateBeforeApprove(intent)) {
    const check = await revalidatePendingIntent(userId, intentId);
    if (!check.valid) {
      await updateIntentStatus(intentId, "cancelled", check.reasonAr);
      const profile = await buildAccountProfile(userId, intent.symbol);
      await dispatchAlert(userId, {
        type: "signal",
        title: `إلغاء ${intent.symbol}`,
        text: cancelledTradeCard({
          symbol: intent.symbol,
          reason: check.reasonAr,
          profile,
        }),
        symbol: intent.symbol,
      });
      return {
        ok: false,
        status: "cancelled",
        reason: check.reasonAr,
        revalidated: true,
      };
    }
  }

  await updateIntentStatus(intentId, "approved", "وافق المشغّل.");
  const result = await executeIntent(userId, intentId, {
    explicitApproval: true,
    practiceMode: intent.practice === 1,
  });

  if (result.ok && result.trade) {
    await notifyTradeResult(userId, result, intent.symbol, "1h", null);
  }

  return {
    ok: result.ok,
    status: result.status,
    reason: result.reason,
    tradeId: result.tradeId ?? null,
    revalidated: shouldRevalidateBeforeApprove(intent),
  };
}
