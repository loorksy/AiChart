import {
  getSettings,
  getLimits,
  getRecommendation,
  getTodayUsage,
  incrementUsage,
  updateIntentNotional,
  updateIntentStatus,
} from "./store";
import { executeIntent } from "./execution";
import { notifyTradeResult } from "./notifyTrade";
import { validateOpportunity } from "./opportunityCheck";
import {
  amountKeyboard,
  amountStepCard,
  rescanConfirmCard,
  staleOpportunityCard,
  ANALYZE_COST_HINT,
} from "./telegramApproval";
import { runMarketAnalyze, MARKET_ANALYZE_COST } from "./marketAnalyze";
import {
  clearTelegramPending,
  setTelegramPending,
} from "./telegramPending";
import {
  editMessageText,
  answerCallback,
} from "./telegram";
import { actionResultCard } from "./telegramBotUi";
import type { TradeIntent } from "./types";

function effectiveCapital(
  settings: Awaited<ReturnType<typeof getSettings>>,
  limits: Awaited<ReturnType<typeof getLimits>>,
): number {
  return limits.max_capital_cap > 0
    ? Math.min(settings.max_capital, limits.max_capital_cap)
    : settings.max_capital;
}

function amountPresets(
  settings: Awaited<ReturnType<typeof getSettings>>,
  limits: Awaited<ReturnType<typeof getLimits>>,
  defaultNotional: number,
): number[] {
  const cap = effectiveCapital(settings, limits);
  const base = defaultNotional;
  const uniq = new Set<number>([
    Math.round(base * 100) / 100,
    Math.round(cap * 0.5 * 100) / 100,
    Math.round(cap * 0.75 * 100) / 100,
    Math.round(cap * 100) / 100,
  ]);
  return [...uniq].filter((n) => n > 0).slice(0, 4);
}

async function checkIntent(
  intent: TradeIntent,
  rec: Awaited<ReturnType<typeof getRecommendation>>,
) {
  return validateOpportunity({
    symbol: intent.symbol,
    side: intent.side,
    entry: intent.entry,
    stop_loss: intent.stop_loss,
    take_profit: intent.take_profit,
    timeframe: rec?.timeframe,
    created_at: intent.created_at,
    chart_drawings_json: rec?.chart_drawings_json,
  });
}

export async function handleApproveStart(
  userId: number,
  intent: TradeIntent,
  chatId: number,
  messageId: number,
  callbackId: string,
): Promise<void> {
  const rec = intent.recommendation_id
    ? await getRecommendation(intent.recommendation_id)
    : null;
  const check = await checkIntent(intent, rec);

  if (!check.canExecute) {
    await updateIntentStatus(intent.id, "expired", check.messageAr);
    await clearTelegramPending(userId);
    await answerCallback(callbackId, "انتهت الفرصة");
    await editMessageText(
      chatId,
      messageId,
      staleOpportunityCard(intent, check, intent.entry),
      [
        [
          {
            text: "🔍 نعم · فرصة جديدة",
            callback_data: `rescan:yes:${intent.id}`,
          },
          { text: "لا شكراً", callback_data: `rescan:no:${intent.id}` },
        ],
      ],
    );
    return;
  }

  const settings = await getSettings(userId);
  const limits = await getLimits(userId);
  const amounts = amountPresets(settings, limits, intent.notional);

  await setTelegramPending(userId, intent.id, "awaiting_amount", messageId);
  await answerCallback(callbackId, "اختر المبلغ");
  await editMessageText(
    chatId,
    messageId,
    amountStepCard(intent),
    amountKeyboard(intent.id, amounts),
  );
}

export async function handleAmountSelect(
  userId: number,
  intent: TradeIntent,
  notional: number,
  chatId: number,
  messageId: number,
  callbackId: string,
): Promise<void> {
  const settings = await getSettings(userId);
  const limits = await getLimits(userId);
  const cap = effectiveCapital(settings, limits);
  if (notional <= 0 || notional > cap) {
    await answerCallback(callbackId, `الحد الأقصى ${cap.toFixed(0)} USDT`, true);
    return;
  }

  await updateIntentNotional(intent.id, notional);
  const updated = { ...intent, notional };
  const rec = intent.recommendation_id
    ? await getRecommendation(intent.recommendation_id)
    : null;
  const check = await checkIntent(updated, rec);

  if (!check.canExecute) {
    await updateIntentStatus(intent.id, "expired", check.messageAr);
    await clearTelegramPending(userId);
    await answerCallback(callbackId, "انتهت الفرصة");
    await editMessageText(
      chatId,
      messageId,
      staleOpportunityCard(updated, check, intent.entry),
      [
        [
          {
            text: "🔍 نعم · فرصة جديدة",
            callback_data: `rescan:yes:${intent.id}`,
          },
          { text: "لا شكراً", callback_data: `rescan:no:${intent.id}` },
        ],
      ],
    );
    return;
  }

  await updateIntentStatus(intent.id, "approved", "وافق المستخدم عبر تليجرام.");
  await clearTelegramPending(userId);
  const result = await executeIntent(userId, intent.id);
  await notifyTradeResult(userId, result, intent.symbol, rec?.timeframe ?? "1h");
  if (callbackId !== "0") {
    await answerCallback(
      callbackId,
      result.ok ? "تم التنفيذ ✅" : "تعذّر التنفيذ",
    );
  }
  if (!messageId) return;
  await editMessageText(
    chatId,
    messageId,
    result.ok
      ? actionResultCard(
          "✅",
          "نُفّذت التوصية",
          `${intent.symbol} · ${notional.toFixed(2)} USDT`,
        )
      : actionResultCard("⚠️", "لم تُنفَّذ", result.reason ?? "سبب غير معروف"),
    null,
  );
}

export async function handleAmountCustom(
  userId: number,
  intent: TradeIntent,
  chatId: number,
  messageId: number,
  callbackId: string,
): Promise<void> {
  await setTelegramPending(userId, intent.id, "awaiting_custom_amount", messageId);
  await answerCallback(callbackId);
  await editMessageText(
    chatId,
    messageId,
    `${amountStepCard(intent)}\n\nاكتب المبلغ بالـ USDT (مثال: 150):`,
    [[{ text: "❌ إلغاء", callback_data: `reject:${intent.id}` }]],
  );
}

export async function handleCustomAmountText(
  userId: number,
  text: string,
  chatId: number,
): Promise<boolean> {
  const { getTelegramPending } = await import("./telegramPending");
  const { getIntent } = await import("./store");
  const pending = await getTelegramPending(userId);
  if (!pending || pending.step !== "awaiting_custom_amount") return false;

  const amount = Number(text.replace(/,/g, "").trim());
  if (!Number.isFinite(amount) || amount <= 0) {
    const { sendMessage } = await import("./telegram");
    await sendMessage(chatId, "أدخل رقماً صالحاً بالـ USDT، مثل 100");
    return true;
  }

  const intent = await getIntent(pending.intent_id);
  if (!intent || intent.user_id !== userId) {
    await clearTelegramPending(userId);
    return true;
  }

  const msgId = pending.message_id ?? 0;
  await handleAmountSelect(
    userId,
    intent,
    amount,
    chatId,
    msgId,
    "0",
  );
  return true;
}

export async function handleRescanYes(
  userId: number,
  intent: TradeIntent,
  chatId: number,
  messageId: number,
  callbackId: string,
): Promise<void> {
  const rec = intent.recommendation_id
    ? await getRecommendation(intent.recommendation_id)
    : null;
  const tf = rec?.timeframe ?? "1h";
  await setTelegramPending(userId, intent.id, "awaiting_rescan_confirm", messageId);
  await answerCallback(callbackId);
  await editMessageText(
    chatId,
    messageId,
    rescanConfirmCard(intent.symbol, tf),
    [
      [
        {
          text: "✅ تأكيد البحث",
          callback_data: `rescan:confirm:${intent.id}`,
        },
        { text: "إلغاء", callback_data: `rescan:no:${intent.id}` },
      ],
    ],
  );
}

export async function handleRescanConfirm(
  userId: number,
  intent: TradeIntent,
  chatId: number,
  messageId: number,
  callbackId: string,
): Promise<void> {
  const limits = await getLimits(userId);
  const used = await getTodayUsage(userId);
  if (
    limits.claude_quota > 0 &&
    used + MARKET_ANALYZE_COST > limits.claude_quota
  ) {
    await answerCallback(callbackId, "رصيد غير كافٍ", true);
    return;
  }

  const rec = intent.recommendation_id
    ? await getRecommendation(intent.recommendation_id)
    : null;
  const tf = rec?.timeframe ?? "1h";
  const settings = await getSettings(userId);

  await updateIntentStatus(intent.id, "expired", "استبدال بتحليل جديد.");
  await clearTelegramPending(userId);
  await answerCallback(callbackId, "جارٍ التحليل…");

  await editMessageText(
    chatId,
    messageId,
    actionResultCard("🔍", "جارٍ البحث عن فرصة جديدة", intent.symbol),
    null,
  );

  try {
    const result = await runMarketAnalyze(
      userId,
      settings,
      intent.symbol,
      tf,
      { telegramSession: true },
    );
    await incrementUsage(userId, MARKET_ANALYZE_COST);
    const sent = result.intents.length > 0;
    await editMessageText(
      chatId,
      messageId,
      actionResultCard(
        sent ? "✅" : "ℹ️",
        sent ? "أُرسلت توصية جديدة" : "لم تُسجَّل فرصة تنفيذ",
        result.reply.slice(0, 400),
      ),
      null,
    );
  } catch (e) {
    await editMessageText(
      chatId,
      messageId,
      actionResultCard(
        "⚠️",
        "تعذّر التحليل",
        e instanceof Error ? e.message : "خطأ",
      ),
      null,
    );
  }
}

export async function handleRescanNo(
  userId: number,
  intent: TradeIntent,
  chatId: number,
  messageId: number,
  callbackId: string,
): Promise<void> {
  await updateIntentStatus(intent.id, "expired", "ألغاه المستخدم بعد انتهاء الفرصة.");
  await clearTelegramPending(userId);
  await answerCallback(callbackId, "حسناً");
  await editMessageText(
    chatId,
    messageId,
    actionResultCard("ℹ️", "أُغلقت الفرصة", "يمكنك طلب تحليلاً جديداً من السوق أو المحادثة."),
    null,
  );
}

export { ANALYZE_COST_HINT };
