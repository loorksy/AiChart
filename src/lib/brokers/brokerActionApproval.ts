/**
 * Approval-gated raw broker actions: modify a pending order, cancel one, or
 * close every open position on a symbol. None of these sizes a new
 * position, so none of them goes through executeIntent/placeOrder — they
 * apply directly on approval, exactly like tradeManagement.ts's SL/TP sync,
 * just without that module's recommendation/revision coupling (these are
 * raw account actions, not necessarily tied to an AiChart-tracked plan).
 *
 * Two-step, non-blocking, same as every other approval: create a pending
 * intent + Telegram card here, apply the broker call only from
 * respondToBrokerActionIntent after the operator approves.
 */
import { createIntent, updateIntentStatus } from "@/lib/store";
import { buildAccountProfile } from "@/lib/accountProfile";
import { dispatchAlert, type DispatchAlertOptions } from "@/lib/alerts";
import { buildApprovalButtons } from "@/lib/telegramCommands";
import { formatCard } from "@/lib/telegramCards";
import { getUserMetaApiConnection } from "@/lib/brokers/metaApiDirect";
import { createLogger } from "@/lib/logger";
import type { TradeIntent } from "@/lib/types";

const log = createLogger("brokers:action-approval");

export type BrokerActionKind = "modify_order" | "cancel_order" | "close_position_by_symbol";

export interface ModifyOrderParams {
  orderId: string;
  openPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
}
export interface CancelOrderParams {
  orderId: string;
}
export interface ClosePositionBySymbolParams {
  symbol: string;
}

export type BrokerActionPayload =
  | { action: "modify_order"; params: ModifyOrderParams }
  | { action: "cancel_order"; params: CancelOrderParams }
  | { action: "close_position_by_symbol"; params: ClosePositionBySymbolParams };

/** Injectable seam so tests exercise the flow without a live broker/Telegram. */
export interface BrokerActionDeps {
  notify?: (userId: number, opts: DispatchAlertOptions) => Promise<unknown>;
}

function describeAction(payload: BrokerActionPayload): string {
  switch (payload.action) {
    case "modify_order": {
      const p = payload.params;
      const parts = [
        p.openPrice != null ? `سعر جديد ${p.openPrice}` : null,
        p.stopLoss != null ? `SL ${p.stopLoss}` : null,
        p.takeProfit != null ? `TP ${p.takeProfit}` : null,
      ].filter(Boolean);
      return `تعديل الأمر المعلّق #${p.orderId}: ${parts.join("، ") || "بلا تغيير"}`;
    }
    case "cancel_order":
      return `إلغاء الأمر المعلّق #${payload.params.orderId}`;
    case "close_position_by_symbol":
      return `إغلاق كل صفقات ${payload.params.symbol} المفتوحة`;
  }
}

/** Create a pending approval intent for a raw broker action. */
export async function createBrokerActionApprovalRequest(
  userId: number,
  input: { payload: BrokerActionPayload; symbol: string },
): Promise<{ intentId: number; telegramDelivered: boolean; reasonAr?: string }> {
  const description = describeAction(input.payload);

  const intent = await createIntent(userId, {
    authorization_source: "broker_action",
    symbol: input.symbol,
    // Not a sized order: side is not meaningful here, but the column is
    // required — 'buy' is a harmless placeholder never read by execution
    // (checkAuthorizationSource refuses this source before anything sizes).
    side: "buy",
    notional: 0,
    status: "pending",
    rationale: description,
    action_json: JSON.stringify(input.payload),
  });

  const profile = await buildAccountProfile(userId, intent.symbol);
  const caption = formatCard(
    `🤖 طلب إجراء على الحساب — ${intent.symbol}`,
    [`🔹 ${description}`, "🔹 اضغط موافق أو رفض أدناه."],
    profile,
  );
  const buttons = buildApprovalButtons(intent.id);

  const delivery = await dispatchAlert(userId, {
    type: "signal",
    title: `طلب إجراء ${intent.symbol}`,
    text: caption,
    symbol: intent.symbol,
    buttons,
  });

  return {
    intentId: intent.id,
    telegramDelivered: delivery.delivered,
    reasonAr: delivery.reasonAr,
  };
}

/** Apply a broker-action intent the operator APPROVED. */
export async function applyApprovedBrokerAction(
  userId: number,
  intent: TradeIntent,
): Promise<{ ok: boolean; reason: string }> {
  if (intent.authorization_source !== "broker_action") {
    return { ok: false, reason: "ليس طلب إجراء على الحساب." };
  }
  let payload: BrokerActionPayload;
  try {
    payload = JSON.parse(intent.action_json ?? "");
  } catch {
    return { ok: false, reason: "تعذّرت قراءة تفاصيل الإجراء المطلوب." };
  }

  try {
    const conn = await getUserMetaApiConnection(userId);
    if (payload.action === "modify_order") {
      const { orderId, openPrice, stopLoss, takeProfit } = payload.params;
      await conn.modifyOrder(orderId, openPrice ?? 0, stopLoss, takeProfit);
      return { ok: true, reason: `عُدّل الأمر المعلّق #${orderId}.` };
    }
    if (payload.action === "cancel_order") {
      const { orderId } = payload.params;
      await conn.cancelOrder(orderId);
      return { ok: true, reason: `أُلغي الأمر المعلّق #${orderId}.` };
    }
    if (payload.action === "close_position_by_symbol") {
      const { symbol } = payload.params;
      await conn.closePositionsBySymbol(symbol);
      return { ok: true, reason: `أُغلقت كل صفقات ${symbol} المفتوحة.` };
    }
    return { ok: false, reason: "إجراء غير معروف." };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "رفض الوسيط تنفيذ الإجراء.";
    log.warn("broker action failed", {
      userId,
      intentId: intent.id,
      action: payload.action,
      error: reason,
    });
    return { ok: false, reason };
  }
}

/**
 * The one entry point the approval respond path needs — mirrors
 * respondToTradeManagementIntent's shape exactly, for the same reason: this
 * must run BEFORE any order-sizing machinery, since a broker action is never
 * a sized order.
 */
export async function respondToBrokerActionIntent(
  userId: number,
  intent: TradeIntent,
  action: "approve" | "reject",
  deps: BrokerActionDeps = {},
): Promise<{ ok: boolean; status: string; reason?: string }> {
  if (intent.authorization_source !== "broker_action") {
    return { ok: false, status: "failed", reason: "ليس طلب إجراء على الحساب." };
  }
  if (action === "reject") {
    await updateIntentStatus(intent.id, "rejected", "رفضه المشغّل.");
    return { ok: true, status: "rejected" };
  }
  const outcome = await applyApprovedBrokerAction(userId, intent);
  await updateIntentStatus(
    intent.id,
    outcome.ok ? "executed" : "failed",
    outcome.reason,
  );
  const notify = deps.notify ?? dispatchAlert;
  await notify(userId, {
    type: "signal",
    title: outcome.ok ? `تم تنفيذ الإجراء — ${intent.symbol}` : `فشل الإجراء — ${intent.symbol}`,
    text: outcome.reason,
    symbol: intent.symbol,
  }).catch(() => undefined);
  return {
    ok: outcome.ok,
    status: outcome.ok ? "executed" : "failed",
    reason: outcome.reason,
  };
}
