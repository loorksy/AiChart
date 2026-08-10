import {
  getMtAccount,
  getMtAccountMeta,
  recordTrade,
  updateIntentStatus,
} from "../store";
import {
  getRpcConnection,
  metaApiSpecToEaSpec,
} from "../metaapi/client";
import { computeForexLots, resolveSizingReferencePrice } from "./lotSizing";
import type { BrokerAdapter, OrderResult, PlaceOrderContext } from "./types";

/** MetaTrader execution via MetaApi cloud (mobile-friendly, no local terminal). */
export const metaApiAdapter: BrokerAdapter = {
  kind: "metaapi",

  async isConnected(userId: number): Promise<boolean> {
    const meta = await getMtAccountMeta(userId);
    return Boolean(meta?.online);
  },

  notConnectedReason(): string {
    return "MetaTrader غير متصل. افتح الإعدادات واربط حسابك (رقم الحساب + كلمة المرور + السيرفر).";
  },

  async placeOrder(
    userId: number,
    { intent, riskAmount, push }: PlaceOrderContext,
  ): Promise<OrderResult> {
    push({ id: "creds", label: "التحقق من اتصال MetaTrader", status: "running" });
    const account = await getMtAccount(userId);
    const meta = await getMtAccountMeta(userId);
    if (!account || !meta?.online) {
      const reason = this.notConnectedReason();
      push({ id: "creds", label: "التحقق من اتصال MetaTrader", status: "error", detail: reason });
      await updateIntentStatus(intent.id, "failed", reason);
      return { ok: false, status: "failed", reason };
    }

    push({
      id: "creds",
      label: `MetaTrader متصل · ${meta.platform.toUpperCase()} · ${meta.server}`,
      status: "done",
    });

    push({ id: "quote", label: `حساب حجم اللوت · ${intent.symbol}`, status: "running" });
    let conn;
    try {
      conn = await getRpcConnection(userId, account.metaapi_account_id);
    } catch (err) {
      const reason =
        err instanceof Error ? err.message : "تعذّر الاتصال بـ MetaTrader.";
      push({ id: "quote", label: `حساب حجم اللوت · ${intent.symbol}`, status: "error", detail: reason });
      await updateIntentStatus(intent.id, "failed", reason);
      return { ok: false, status: "failed", reason };
    }

    const rawSpec = (await conn.getSymbolSpecification(intent.symbol)) as Record<
      string,
      unknown
    >;
    let priceQuote: { bid?: number; ask?: number } = {};
    try {
      const px = await conn.getSymbolPrice(intent.symbol, false);
      priceQuote = { bid: Number(px.bid), ask: Number(px.ask) };
    } catch {
      /* spec may include bid/ask */
    }
    const spec = metaApiSpecToEaSpec(intent.symbol, rawSpec, priceQuote);
    const sideQuote =
      intent.side === "buy" ? Number(spec.ask) : Number(spec.bid);
    const orderType = intent.order_type ?? "market";
    const refPrice = resolveSizingReferencePrice({
      orderType,
      limitPrice: intent.limit_price,
      analysedEntry: intent.entry,
      sideQuote,
      ask: Number(spec.ask),
      bid: Number(spec.bid),
    });
    if ((orderType === "limit" || orderType === "stop") && !(refPrice > 0)) {
      const reason = `أمر ${orderType === "limit" ? "معلّق (limit)" : "معلّق (stop)"} بلا سعر تفعيل صالح.`;
      push({ id: "quote", label: `حساب حجم اللوت · ${intent.symbol}`, status: "error", detail: reason });
      await updateIntentStatus(intent.id, "failed", reason);
      return { ok: false, status: "failed", reason };
    }
    const sizing = computeForexLots(riskAmount, refPrice, intent.stop_loss, spec);
    if (!sizing.ok) {
      push({ id: "quote", label: `حساب حجم اللوت · ${intent.symbol}`, status: "error", detail: sizing.reason });
      await updateIntentStatus(intent.id, "failed", sizing.reason ?? "تعذّر حساب اللوت.");
      return { ok: false, status: "failed", reason: sizing.reason ?? "تعذّر حساب اللوت." };
    }
    push({
      id: "quote",
      label: `حجم اللوت · ${intent.symbol}`,
      status: "done",
      detail: `${sizing.lots} لوت`,
    });

    const sideLabel = intent.side === "buy" ? "شراء" : "بيع";
    push({
      id: "order",
      label: `تنفيذ ${sideLabel} · ${sizing.lots} لوت ${intent.symbol}`,
      status: "running",
    });

    try {
      const sl = intent.stop_loss ?? undefined;
      const tp = intent.take_profit ?? undefined;
      const comment = { comment: `Lonora #${intent.id}` };
      const result =
        orderType === "limit"
          ? intent.side === "buy"
            ? await conn.createLimitBuyOrder(intent.symbol, sizing.lots, refPrice, sl, tp, comment)
            : await conn.createLimitSellOrder(intent.symbol, sizing.lots, refPrice, sl, tp, comment)
          : orderType === "stop"
            ? intent.side === "buy"
              ? await conn.createStopBuyOrder(intent.symbol, sizing.lots, refPrice, sl, tp, comment)
              : await conn.createStopSellOrder(intent.symbol, sizing.lots, refPrice, sl, tp, comment)
            : intent.side === "buy"
              ? await conn.createMarketBuyOrder(intent.symbol, sizing.lots, sl, tp, comment)
              : await conn.createMarketSellOrder(intent.symbol, sizing.lots, sl, tp, comment);

      const ticket =
        result.orderId != null
          ? String(result.orderId)
          : result.positionId != null
            ? String(result.positionId)
            : null;
      const fillPrice = refPrice;
      // A limit/stop order is PLACED, not filled — it has no position yet, so
      // it must never read as an open trade (get_open_trades filters on
      // status='open' exactly to keep a resting order out of that list).
      const pending = orderType === "limit" || orderType === "stop";

      const trade = await recordTrade(userId, {
        intent_id: intent.id,
        symbol: intent.symbol,
        side: intent.side,
        qty: sizing.lots,
        quote_qty: sizing.lots * fillPrice * (Number(spec.contract_size) || 0),
        avg_price: fillPrice,
        order_id: ticket,
        env: meta.platform,
        market: "forex",
        broker: "metaapi",
        status: pending ? "pending" : "open",
      });

      push({
        id: "order",
        label: `${pending ? "وضع" : "تنفيذ"} ${sideLabel} · ${sizing.lots} لوت ${intent.symbol}`,
        status: "done",
        detail: ticket ? `تذكرة #${ticket}` : pending ? "أمر معلّق" : "نُفّذت",
      });
      push({ id: "record", label: "تسجيل الصفقة وإرسال الإشعار", status: "done" });

      await updateIntentStatus(
        intent.id,
        "executed",
        ticket
          ? `${pending ? "وُضع الأمر المعلّق" : "نُفّذت"} (تذكرة #${ticket}).`
          : "نُفّذت عبر MetaTrader.",
      );
      return {
        ok: true,
        status: "executed",
        reason: pending ? "وُضع الأمر المعلّق." : "تم التنفيذ.",
        tradeId: trade.id,
        trade: {
          symbol: trade.symbol,
          side: trade.side,
          qty: trade.qty,
          avg_price: trade.avg_price,
          env: trade.env,
        },
      };
    } catch (err) {
      const reason =
        err instanceof Error
          ? err.message
          : "رفض MetaTrader الأمر.";
      push({ id: "order", label: `تنفيذ ${sideLabel} · ${intent.symbol}`, status: "error", detail: reason });
      await updateIntentStatus(intent.id, "failed", reason);
      return { ok: false, status: "failed", reason };
    }
  },
};
