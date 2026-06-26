import {
  createEaCommand,
  getEaConnection,
  getEaSymbolSpec,
  isEaOnlineDebounced,
} from "../eaStore";
import {
  waitForEaCommandAck,
  EA_ACK_TIMEOUT_MS,
  type EaCommandAckResult,
} from "../eaCommandWait";
import { recordTrade, updateIntentStatus } from "../store";
import { computeForexLots } from "./lotSizing";
import { normalizeMt5Stops } from "./mt5Stops";
import {
  formatEaSymbolHint,
  getEaSymbolList,
  resolveMt5Symbol,
} from "../mt5SymbolMap";
import { parseMt5Retcode } from "./mt5Retcode";
import { BridgeErrorCode } from "../bridge/errors";
import type { BrokerAdapter, OrderResult, PlaceOrderContext } from "./types";
import type { EaSymbolSpec } from "../types";

/** Max time to wait for the EA to confirm a command before failing the order. */
const ACK_TIMEOUT_MS = EA_ACK_TIMEOUT_MS;

function isRetriableEaFailure(ack: EaCommandAckResult): boolean {
  if (ack.status === "expired") return true;
  const raw = ack.result?.error != null ? String(ack.result.error) : "";
  return parseMt5Retcode(raw) === 10012;
}

function sideQuotePrice(
  side: "buy" | "sell",
  spec: EaSymbolSpec | null,
): number {
  if (!spec) return 0;
  return side === "buy" ? Number(spec.ask) : Number(spec.bid);
}

/** MetaTrader (MT4/MT5) execution backend via the self-hosted EA bridge. */
export const eaAdapter: BrokerAdapter = {
  kind: "mt_ea",

  async isConnected(userId: number): Promise<boolean> {
    const conn = await getEaConnection(userId);
    if (!conn || conn.status === "revoked") return false;
    return isEaOnlineDebounced(userId, conn.last_heartbeat_at);
  },

  notConnectedReason(): string {
    return "MetaTrader غير متصل. افتح المنصّة وتأكد من تشغيل EA وتفعيل التداول الآلي.";
  },

  async placeOrder(
    userId: number,
    { intent, push }: PlaceOrderContext,
  ): Promise<OrderResult> {
    push({ id: "creds", label: "التحقق من اتصال MetaTrader", status: "running" });
    const conn = await getEaConnection(userId);
    if (!conn || conn.status === "revoked" || !isEaOnlineDebounced(userId, conn.last_heartbeat_at)) {
      const reason = this.notConnectedReason();
      push({ id: "creds", label: "التحقق من اتصال MetaTrader", status: "error", detail: reason });
      await updateIntentStatus(intent.id, "failed", reason);
      return { ok: false, status: "failed", reason };
    }
    push({
      id: "creds",
      label: `MetaTrader متصل · ${conn.platform.toUpperCase()}${conn.broker_name ? ` · ${conn.broker_name}` : ""}`,
      status: "done",
    });

    const mt5Symbol = await resolveMt5Symbol(userId, intent.symbol);
    if (!mt5Symbol) {
      const available = await getEaSymbolList(userId);
      const hint = formatEaSymbolHint(available);
      const reason = `الرمز ${intent.symbol} غير موجود في heartbeat MetaTrader — أضفه إلى Market Watch. Available: ${hint}`;
      push({ id: "quote", label: `الرمز · ${intent.symbol}`, status: "error", detail: reason });
      await updateIntentStatus(intent.id, "failed", reason);
      return { ok: false, status: "failed", reason };
    }

    const attemptOrder = async (): Promise<{
      result: OrderResult;
      ack: EaCommandAckResult;
    }> => {
      push({ id: "quote", label: `حساب حجم اللوت · ${mt5Symbol}`, status: "running" });
      const spec = await getEaSymbolSpec(userId, mt5Symbol);
      const isLimit =
        intent.order_type === "limit" &&
        intent.limit_price != null &&
        intent.limit_price > 0;
      const refPrice = isLimit
        ? intent.limit_price!
        : (intent.entry ?? 0) ||
          sideQuotePrice(intent.side, spec) ||
          Number(spec?.ask) ||
          Number(spec?.bid) ||
          0;
      const sizing = computeForexLots(intent.notional, refPrice, spec);
      if (!sizing.ok) {
        const reason = sizing.reason ?? "تعذّر حساب اللوت.";
        push({ id: "quote", label: `حساب حجم اللوت · ${intent.symbol}`, status: "error", detail: reason });
        await updateIntentStatus(intent.id, "failed", reason);
        return {
          result: { ok: false, status: "failed", reason },
          ack: { ok: false, status: "failed", result: null, reason },
        };
      }
      push({
        id: "quote",
        label: `حجم اللوت · ${intent.symbol}`,
        status: "done",
        detail: `${sizing.lots} لوت`,
      });

      const stops = normalizeMt5Stops(
        intent.side,
        refPrice,
        intent.stop_loss,
        intent.take_profit,
        spec,
        { referencePrice: isLimit ? "entry" : "market" },
      );
      if (stops.note) {
        push({
          id: "stops",
          label: `ضبط SL/TP · ${intent.symbol}`,
          status: "done",
          detail: stops.note,
        });
      }

      if (!stops.stop_loss || stops.stop_loss <= 0) {
        const reason = "وقف الخسارة مطلوب لفتح الصفقة على MetaTrader.";
        push({
          id: "stops",
          label: `وقف الخسارة · ${intent.symbol}`,
          status: "error",
          detail: reason,
        });
        await updateIntentStatus(intent.id, "failed", reason);
        return {
          result: { ok: false, status: "failed", reason },
          ack: { ok: false, status: "failed", result: null, reason },
        };
      }

      const sideLabel = intent.side === "buy" ? "شراء" : "بيع";
      const orderLabel = isLimit
        ? `إرسال أمر معلّق ${sideLabel} @ ${refPrice} · ${sizing.lots} لوت`
        : `إرسال أمر ${sideLabel} · ${sizing.lots} لوت ${intent.symbol}`;
      push({
        id: "order",
        label: orderLabel,
        status: "running",
      });
      const command = await createEaCommand(userId, {
        intent_id: intent.id,
        command_type: isLimit ? "open_pending" : "open_market",
        payload: isLimit
          ? {
              symbol: mt5Symbol,
              side: intent.side,
              order_type: "limit",
              lots: sizing.lots,
              price: refPrice,
              stop_loss: stops.stop_loss,
              take_profit: stops.take_profit,
            }
          : {
              symbol: mt5Symbol,
              side: intent.side,
              lots: sizing.lots,
              stop_loss: stops.stop_loss,
              take_profit: stops.take_profit,
            },
        ttlMs: ACK_TIMEOUT_MS,
      });

      const ack = await waitForEaCommandAck(command.id, ACK_TIMEOUT_MS);
      const result = await finalizeAck(
        userId,
        intent,
        conn,
        spec,
        sizing.lots,
        ack,
        push,
        sideLabel,
      );
      return { result, ack };
    };

    let { result, ack } = await attemptOrder();
    if (!result.ok && isRetriableEaFailure(ack)) {
      push({
        id: "quote",
        label: `تحديث السعر وإعادة المحاولة · ${intent.symbol}`,
        status: "running",
      });
      ({ result, ack } = await attemptOrder());
    }

    if (!result.ok && isRetriableEaFailure(ack)) {
      const reason =
        "انتهت مهلة تنفيذ MetaTrader بعد إعادة المحاولة — تأكد من اتصال المنصّة.";
      await updateIntentStatus(intent.id, "failed", reason);
      return {
        ok: false,
        status: "failed",
        reason,
        errorCode: BridgeErrorCode.UPSTREAM_TIMEOUT,
      };
    }

    return result;
  },
};

async function finalizeAck(
  userId: number,
  intent: PlaceOrderContext["intent"],
  conn: NonNullable<Awaited<ReturnType<typeof getEaConnection>>>,
  spec: EaSymbolSpec | null,
  defaultLots: number,
  ack: EaCommandAckResult,
  push: PlaceOrderContext["push"],
  sideLabel: string,
): Promise<OrderResult> {
  const result = ack.result;
  const isLimit =
    intent.order_type === "limit" &&
    intent.limit_price != null &&
    intent.limit_price > 0;

  if (!ack.ok) {
    const reason = ack.reason ?? "رفض MetaTrader الأمر.";
    push({ id: "order", label: `إرسال أمر ${sideLabel} · ${intent.symbol}`, status: "error", detail: reason });
    await updateIntentStatus(intent.id, "failed", reason);
    return { ok: false, status: "failed", reason };
  }

  const ticket = result?.ticket != null ? String(result.ticket) : null;
  const refPrice =
    Number(result?.price) ||
    sideQuotePrice(intent.side, spec) ||
    Number(spec?.ask) ||
    Number(spec?.bid) ||
    0;
  const filledLots = Number(result?.lots) || defaultLots;

  const trade = await recordTrade(userId, {
    intent_id: intent.id,
    symbol: intent.symbol,
    side: intent.side,
    qty: filledLots,
    quote_qty: filledLots * refPrice * (Number(spec?.contract_size) || 0),
    avg_price: refPrice,
    order_id: ticket,
    env: conn.account_trade_mode === "live" ? "live" : "demo",
    market: "forex",
    broker: "mt_ea",
    status: "open",
  });

  push({
    id: "order",
    label: isLimit
      ? `أمر معلّق ${sideLabel} @ ${Number(intent.limit_price ?? refPrice)}`
      : `تنفيذ ${sideLabel} · ${filledLots} لوت ${intent.symbol}`,
    status: "done",
    detail: ticket
      ? isLimit
        ? `أمر معلّق #${ticket}`
        : `تذكرة #${ticket}`
      : isLimit
        ? "أُرسل كأمر معلّق"
        : "نُفّذت",
  });
  push({ id: "record", label: "تسجيل الصفقة وإرسال الإشعار", status: "done" });

  await updateIntentStatus(
    intent.id,
    "executed",
    isLimit
      ? ticket
        ? `أمر معلّق @ ${Number(intent.limit_price ?? refPrice)} (تذكرة #${ticket}).`
        : `أمر معلّق @ ${Number(intent.limit_price ?? refPrice)}.`
      : ticket
        ? `نُفّذت (تذكرة #${ticket}).`
        : "نُفّذت عبر MetaTrader.",
  );
  return {
    ok: true,
    status: "executed",
    reason: "تم التنفيذ.",
    tradeId: trade.id,
    trade: {
      symbol: trade.symbol,
      side: trade.side,
      qty: trade.qty,
      avg_price: trade.avg_price,
      env: trade.env,
    },
  };
}
