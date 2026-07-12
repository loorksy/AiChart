import {
  getMtAccountMeta,
  recordTrade,
  updateIntentStatus,
} from "../store";
import {
  isMt5LocalConfigured,
  mt5Order,
  mt5Spec,
} from "../mt5local/client";
import { computeForexLots } from "./lotSizing";
import type { BrokerAdapter, OrderResult, PlaceOrderContext } from "./types";

/** MetaTrader 5 execution via the self-hosted bridge container (no cloud). */
export const mt5LocalAdapter: BrokerAdapter = {
  kind: "mt5_local",

  async isConnected(userId: number): Promise<boolean> {
    if (!isMt5LocalConfigured()) return false;
    const meta = await getMtAccountMeta(userId);
    return Boolean(meta?.online);
  },

  notConnectedReason(): string {
    return "MetaTrader 5 غير متصل. افتح الإعدادات واربط حسابك (السيرفر + رقم الحساب + كلمة المرور).";
  },

  async placeOrder(
    userId: number,
    { intent, push }: PlaceOrderContext,
  ): Promise<OrderResult> {
    push({ id: "creds", label: "التحقق من اتصال MT5", status: "running" });
    const meta = await getMtAccountMeta(userId);
    if (!isMt5LocalConfigured() || !meta?.online) {
      const reason = this.notConnectedReason();
      push({ id: "creds", label: "التحقق من اتصال MT5", status: "error", detail: reason });
      await updateIntentStatus(intent.id, "failed", reason);
      return { ok: false, status: "failed", reason };
    }
    push({
      id: "creds",
      label: `MT5 متصل · ${meta.server}`,
      status: "done",
    });

    // Multi-tenant safety: pin every bridge call to THIS user's account so the
    // shared terminal can never place the order on another user's account.
    const account = { login: meta.login, server: meta.server };

    push({ id: "quote", label: `حساب حجم اللوت · ${intent.symbol}`, status: "running" });
    let spec;
    try {
      spec = await mt5Spec(intent.symbol, account);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "تعذّر جلب مواصفات الرمز.";
      push({ id: "quote", label: `حساب حجم اللوت · ${intent.symbol}`, status: "error", detail: reason });
      await updateIntentStatus(intent.id, "failed", reason);
      return { ok: false, status: "failed", reason };
    }

    const sideQuote =
      intent.side === "buy" ? Number(spec.ask) : Number(spec.bid);
    const refPrice =
      (intent.entry ?? 0) ||
      sideQuote ||
      Number(spec.ask) ||
      Number(spec.bid) ||
      0;
    const sizing = computeForexLots(intent.notional, refPrice, spec);
    if (!sizing.ok) {
      const reason = sizing.reason ?? "تعذّر حساب اللوت.";
      push({ id: "quote", label: `حساب حجم اللوت · ${intent.symbol}`, status: "error", detail: reason });
      await updateIntentStatus(intent.id, "failed", reason);
      return { ok: false, status: "failed", reason };
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
      const result = await mt5Order(account, {
        symbol: intent.symbol,
        side: intent.side,
        lots: sizing.lots,
        sl: intent.stop_loss,
        tp: intent.take_profit,
        comment: `Lonora #${intent.id}`,
      });
      if (!result.ok) {
        const reason = result.reason ?? "رفض MT5 الأمر.";
        push({ id: "order", label: `تنفيذ ${sideLabel} · ${intent.symbol}`, status: "error", detail: reason });
        await updateIntentStatus(intent.id, "failed", reason);
        return { ok: false, status: "failed", reason };
      }

      const fillPrice = result.price || refPrice;
      const lots = result.lots || sizing.lots;
      const trade = await recordTrade(userId, {
        intent_id: intent.id,
        symbol: intent.symbol,
        side: intent.side,
        qty: lots,
        quote_qty: lots * fillPrice * (Number(spec.contract_size) || 0),
        avg_price: fillPrice,
        order_id: result.ticket != null ? String(result.ticket) : null,
        env: "mt5",
        market: "forex",
        broker: "mt5_local",
        status: "open",
      });

      push({
        id: "order",
        label: `تنفيذ ${sideLabel} · ${lots} لوت ${intent.symbol}`,
        status: "done",
        detail: result.ticket ? `تذكرة #${result.ticket}` : "نُفّذت",
      });
      push({ id: "record", label: "تسجيل الصفقة وإرسال الإشعار", status: "done" });
      await updateIntentStatus(
        intent.id,
        "executed",
        result.ticket ? `نُفّذت (تذكرة #${result.ticket}).` : "نُفّذت عبر MT5.",
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
    } catch (err) {
      const reason = err instanceof Error ? err.message : "رفض MT5 الأمر.";
      push({ id: "order", label: `تنفيذ ${sideLabel} · ${intent.symbol}`, status: "error", detail: reason });
      await updateIntentStatus(intent.id, "failed", reason);
      return { ok: false, status: "failed", reason };
    }
  },
};
