import crypto from "crypto";
import { buildAccountProfile } from "./accountProfile";
import { getAppSecret } from "./env";
import { getPlatformValue } from "./platformConfig";
import {
  createIntent,
  getIntent,
  getLimits,
  getRecommendation,
  getSettings,
  updateIntentStatus,
} from "./store";
import { executeIntent } from "./execution";
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

export type ApprovalKind = "trade" | "practice" | "env_switch" | "mode_change";

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
  notional?: number;
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
  if (settings.mode === "direct") {
    throw new Error(
      "وضع التنفيذ «مباشر» — لا بطاقات موافقة. نفّذ بأمر صريح من المستخدم.",
    );
  }
  const limits = await getLimits(userId);
  const market = input.market ?? settings.active_market ?? "crypto";
  const effectiveCapital =
    limits.max_capital_cap > 0
      ? Math.min(settings.max_capital, limits.max_capital_cap)
      : settings.max_capital;
  const notional =
    input.notional ?? (effectiveCapital * settings.per_trade_pct) / 100;

  const intent = await createIntent(userId, {
    recommendation_id: input.recommendation_id ?? null,
    symbol: input.symbol,
    side: input.side,
    notional,
    market,
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
    notional: intent.notional,
    confidence: intent.confidence,
    entry: intent.entry,
    stop_loss: intent.stop_loss,
    take_profit: intent.take_profit,
    profile,
    style: settings.style,
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
    confidence: intent.confidence,
    photoUrl,
    buttons,
    bypassConfidenceGate: true,
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
        bypassConfidenceGate: true,
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
