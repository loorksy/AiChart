import {
  getBinanceCredentials,
  recordTrade,
  updateIntentStatus,
  updateTradeOcoOrderList,
} from "../store";
import {
  getPrice,
  getSymbolFilters,
  roundToStep,
  placeMarketOrder,
  placeOcoOrder,
} from "../binance";
import type { BrokerAdapter, OrderResult, PlaceOrderContext } from "./types";

/** Binance Spot execution backend (the original AiChart flow). */
export const binanceAdapter: BrokerAdapter = {
  kind: "binance",

  async isConnected(userId: number): Promise<boolean> {
    return Boolean(await getBinanceCredentials(userId));
  },

  notConnectedReason(): string {
    return "لا يوجد حساب Binance مرتبط.";
  },

  async placeOrder(
    userId: number,
    { intent, push }: PlaceOrderContext,
  ): Promise<OrderResult> {
    push({ id: "creds", label: "التحقق من حساب Binance", status: "running" });
    const creds = await getBinanceCredentials(userId);
    if (!creds) {
      const reason = this.notConnectedReason();
      push({ id: "creds", label: "التحقق من حساب Binance", status: "error", detail: reason });
      await updateIntentStatus(intent.id, "failed", reason);
      return { ok: false, status: "failed", reason };
    }
    push({
      id: "creds",
      label: `التحقق من حساب Binance · ${creds.env === "testnet" ? "تجريبي" : "حقيقي"}`,
      status: "done",
    });

    try {
      push({
        id: "quote",
        label: `جلب السعر ومرشحات ${intent.symbol}`,
        status: "running",
      });
      const [price, filters] = await Promise.all([
        getPrice(intent.symbol, creds.env),
        getSymbolFilters(intent.symbol, creds.env),
      ]);
      push({
        id: "quote",
        label: `جلب السعر ومرشحات ${intent.symbol}`,
        status: "done",
        detail: `السعر ${price}`,
      });
      const qty = roundToStep(intent.notional / price, filters.stepSize);

      if (qty < filters.minQty || qty <= 0) {
        const reason = `الكمية أقل من الحد الأدنى للرمز (${filters.minQty}).`;
        await updateIntentStatus(intent.id, "failed", reason);
        return { ok: false, status: "failed", reason };
      }
      if (filters.minNotional > 0 && qty * price < filters.minNotional) {
        const reason = `قيمة الصفقة أقل من الحد الأدنى (${filters.minNotional}).`;
        await updateIntentStatus(intent.id, "failed", reason);
        return { ok: false, status: "failed", reason };
      }

      const sideLabel = intent.side === "buy" ? "شراء" : "بيع";
      push({
        id: "order",
        label: `إرسال أمر ${sideLabel} · ${qty} ${intent.symbol}`,
        status: "running",
      });
      const order = await placeMarketOrder(
        creds.apiKey,
        creds.apiSecret,
        creds.env,
        intent.symbol,
        intent.side === "buy" ? "BUY" : "SELL",
        qty,
      );

      const executedQty = Number(order.executedQty) || qty;
      const quoteQty = Number(order.cummulativeQuoteQty) || qty * price;
      const avgPrice = executedQty > 0 ? quoteQty / executedQty : price;

      const trade = await recordTrade(userId, {
        intent_id: intent.id,
        symbol: intent.symbol,
        side: intent.side,
        qty: executedQty,
        quote_qty: quoteQty,
        avg_price: avgPrice,
        order_id: String(order.orderId),
        env: creds.env,
        market: "crypto",
        broker: "binance",
        status: "open",
      });

      if (
        intent.side === "buy" &&
        intent.stop_loss != null &&
        intent.take_profit != null &&
        intent.take_profit > intent.stop_loss
      ) {
        try {
          push({
            id: "oco",
            label: `OCO وقف/هدف · ${intent.symbol}`,
            status: "running",
          });
          const oco = await placeOcoOrder(
            creds.apiKey,
            creds.apiSecret,
            creds.env,
            intent.symbol,
            executedQty,
            intent.take_profit,
            intent.stop_loss,
            filters.tickSize,
          );
          await updateTradeOcoOrderList(trade.id, oco.orderListId);
          push({
            id: "oco",
            label: `OCO وقف/هدف · ${intent.symbol}`,
            status: "done",
            detail: `SL ${intent.stop_loss} · TP ${intent.take_profit}`,
          });
        } catch (e) {
          const ocoErr = e instanceof Error ? e.message : "فشل OCO";
          push({
            id: "oco",
            label: `OCO وقف/هدف · ${intent.symbol}`,
            status: "error",
            detail: ocoErr,
          });
        }
      }

      push({
        id: "order",
        label: `إرسال أمر ${sideLabel} · ${qty} ${intent.symbol}`,
        status: "done",
        detail: `طلب #${order.orderId}`,
      });
      push({ id: "record", label: "تسجيل الصفقة وإرسال الإشعار", status: "done" });

      await updateIntentStatus(intent.id, "executed", `نُفّذت (طلب #${order.orderId}).`);
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
    } catch (e) {
      const reason = e instanceof Error ? e.message : "فشل تنفيذ الأمر.";
      push({
        id: "order",
        label: "إرسال الأمر إلى Binance",
        status: "error",
        detail: reason,
      });
      await updateIntentStatus(intent.id, "failed", reason);
      return { ok: false, status: "failed", reason };
    }
  },
};
