import {
  getBinanceCredentials,
  recordTrade,
  updateIntentStatus,
} from "../store";
import { roundToStep, roundToTick } from "../binance";
import {
  getFuturesPrice,
  getFuturesSymbolFilters,
  placeFuturesExitOrder,
  placeFuturesMarketOrder,
  setIsolatedMargin,
  setLeverage,
} from "../binanceFutures";
import type { BrokerAdapter, OrderResult, PlaceOrderContext } from "./types";

/**
 * Binance USDT-M Futures execution backend (MT5-style: short + leverage).
 *
 * Safety model:
 * - ISOLATED margin only — liquidation risk is capped to the position margin.
 * - intent.notional is the MARGIN the user risks; position size = margin × leverage.
 * - Stop-loss is mandatory (enforced upstream by Risk Guard for futures).
 * - SL/TP are placed as closePosition STOP_MARKET / TAKE_PROFIT_MARKET orders.
 */
export const binanceFuturesAdapter: BrokerAdapter = {
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
    push({ id: "creds", label: "التحقق من حساب Binance Futures", status: "running" });
    const creds = await getBinanceCredentials(userId);
    if (!creds) {
      const reason = this.notConnectedReason();
      push({ id: "creds", label: "التحقق من حساب Binance Futures", status: "error", detail: reason });
      await updateIntentStatus(intent.id, "failed", reason);
      return { ok: false, status: "failed", reason };
    }
    push({
      id: "creds",
      label: `التحقق من حساب Binance Futures · ${creds.env === "testnet" ? "تجريبي" : "حقيقي"}`,
      status: "done",
    });

    const leverage = Math.max(1, intent.leverage ?? 1);
    const positionSide = intent.side === "buy" ? "long" : "short";

    try {
      push({
        id: "quote",
        label: `جلب السعر ومرشحات ${intent.symbol} (Futures)`,
        status: "running",
      });
      const [price, filters] = await Promise.all([
        getFuturesPrice(intent.symbol, creds.env),
        getFuturesSymbolFilters(intent.symbol, creds.env),
      ]);
      push({
        id: "quote",
        label: `جلب السعر ومرشحات ${intent.symbol} (Futures)`,
        status: "done",
        detail: `السعر ${price}`,
      });

      // notional = margin; position size = margin × leverage.
      const positionNotional = intent.notional * leverage;
      const qty = roundToStep(positionNotional / price, filters.stepSize);

      if (qty < filters.minQty || qty <= 0) {
        const reason = `الكمية أقل من الحد الأدنى للرمز (${filters.minQty}).`;
        await updateIntentStatus(intent.id, "failed", reason);
        return { ok: false, status: "failed", reason };
      }
      if (filters.minNotional > 0 && qty * price < filters.minNotional) {
        const reason = `قيمة الصفقة أقل من الحد الأدنى (${filters.minNotional} USDT).`;
        await updateIntentStatus(intent.id, "failed", reason);
        return { ok: false, status: "failed", reason };
      }

      push({
        id: "leverage",
        label: `ضبط الهامش المعزول والرافعة ${leverage}x`,
        status: "running",
      });
      await setIsolatedMargin(creds.apiKey, creds.apiSecret, creds.env, intent.symbol);
      const appliedLeverage = await setLeverage(
        creds.apiKey,
        creds.apiSecret,
        creds.env,
        intent.symbol,
        leverage,
      );
      push({
        id: "leverage",
        label: `ضبط الهامش المعزول والرافعة ${appliedLeverage}x`,
        status: "done",
      });

      const sideLabel = intent.side === "buy" ? "شراء (Long)" : "بيع (Short)";
      push({
        id: "order",
        label: `إرسال أمر ${sideLabel} · ${qty} ${intent.symbol}`,
        status: "running",
      });
      const order = await placeFuturesMarketOrder(
        creds.apiKey,
        creds.apiSecret,
        creds.env,
        intent.symbol,
        intent.side === "buy" ? "BUY" : "SELL",
        qty,
      );

      const executedQty = Number(order.executedQty) || qty;
      const avgPrice = Number(order.avgPrice) || price;
      const quoteQty = Number(order.cumQuote) || executedQty * avgPrice;

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
        market_type: "futures",
        leverage: appliedLeverage,
      });

      // SL/TP exits (close the whole position when triggered).
      if (intent.stop_loss != null) {
        try {
          push({
            id: "sl",
            label: `وقف الخسارة · ${intent.symbol}`,
            status: "running",
          });
          await placeFuturesExitOrder(
            creds.apiKey,
            creds.apiSecret,
            creds.env,
            intent.symbol,
            positionSide,
            "stop_loss",
            roundToTick(intent.stop_loss, filters.tickSize),
          );
          push({
            id: "sl",
            label: `وقف الخسارة · ${intent.symbol}`,
            status: "done",
            detail: `SL ${intent.stop_loss}`,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "فشل وضع وقف الخسارة";
          push({ id: "sl", label: `وقف الخسارة · ${intent.symbol}`, status: "error", detail: msg });
        }
      }
      if (intent.take_profit != null) {
        try {
          push({
            id: "tp",
            label: `جني الأرباح · ${intent.symbol}`,
            status: "running",
          });
          await placeFuturesExitOrder(
            creds.apiKey,
            creds.apiSecret,
            creds.env,
            intent.symbol,
            positionSide,
            "take_profit",
            roundToTick(intent.take_profit, filters.tickSize),
          );
          push({
            id: "tp",
            label: `جني الأرباح · ${intent.symbol}`,
            status: "done",
            detail: `TP ${intent.take_profit}`,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "فشل وضع جني الأرباح";
          push({ id: "tp", label: `جني الأرباح · ${intent.symbol}`, status: "error", detail: msg });
        }
      }

      push({
        id: "order",
        label: `إرسال أمر ${sideLabel} · ${qty} ${intent.symbol}`,
        status: "done",
        detail: `طلب #${order.orderId} · رافعة ${appliedLeverage}x`,
      });
      push({ id: "record", label: "تسجيل الصفقة وإرسال الإشعار", status: "done" });

      await updateIntentStatus(
        intent.id,
        "executed",
        `نُفّذت Futures (طلب #${order.orderId}، رافعة ${appliedLeverage}x).`,
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
    } catch (e) {
      const reason = e instanceof Error ? e.message : "فشل تنفيذ أمر Futures.";
      push({
        id: "order",
        label: "إرسال الأمر إلى Binance Futures",
        status: "error",
        detail: reason,
      });
      await updateIntentStatus(intent.id, "failed", reason);
      return { ok: false, status: "failed", reason };
    }
  },
};
