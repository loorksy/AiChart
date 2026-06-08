import {
  getBinanceCredentials,
  getSettings,
  getLimits,
  getIntent,
  updateIntentStatus,
  recordTrade,
  countOpenTrades,
  todayRealizedPnlPct,
  isMasterKillOn,
} from "./store";
import { evaluateTrade } from "./riskGuard";
import {
  getPrice,
  getSymbolFilters,
  roundToStep,
  placeMarketOrder,
} from "./binance";

export interface ExecutionResult {
  ok: boolean;
  status: "executed" | "failed";
  reason: string;
  tradeId?: number;
}

/**
 * Executes a pending/approved trade intent. The Risk Guard is the gate: no
 * order is sent unless every hard cap passes. Defaults to the user's Binance
 * environment (Testnet by default).
 */
export async function executeIntent(
  userId: number,
  intentId: number,
): Promise<ExecutionResult> {
  const intent = getIntent(intentId);
  if (!intent || intent.user_id !== userId) {
    return { ok: false, status: "failed", reason: "الطلب غير موجود." };
  }
  if (intent.status === "executed") {
    return { ok: false, status: "failed", reason: "سبق تنفيذ هذا الطلب." };
  }

  const settings = getSettings(userId);
  const limits = getLimits(userId);

  const effectiveCapital =
    limits.max_capital_cap > 0
      ? Math.min(settings.max_capital, limits.max_capital_cap)
      : settings.max_capital;

  // 1) Risk Guard — the authority. Nothing executes if this denies.
  const decision = evaluateTrade(settings, limits, {
    symbol: intent.symbol,
    side: intent.side,
    notional: intent.notional,
  }, {
    masterKill: isMasterKillOn(),
    openTradesCount: countOpenTrades(userId),
    todayRealizedPnlPct: todayRealizedPnlPct(userId, effectiveCapital),
  });

  if (!decision.ok) {
    updateIntentStatus(intentId, "failed", decision.reason);
    return { ok: false, status: "failed", reason: decision.reason };
  }

  // 2) Credentials.
  const creds = getBinanceCredentials(userId);
  if (!creds) {
    const reason = "لا يوجد حساب Binance مرتبط.";
    updateIntentStatus(intentId, "failed", reason);
    return { ok: false, status: "failed", reason };
  }

  // 3) Build a valid order (quantity rounded to the symbol's step size).
  try {
    const [price, filters] = await Promise.all([
      getPrice(intent.symbol, "prod"),
      getSymbolFilters(intent.symbol, "prod"),
    ]);
    const qty = roundToStep(intent.notional / price, filters.stepSize);

    if (qty < filters.minQty || qty <= 0) {
      const reason = `الكمية أقل من الحد الأدنى للرمز (${filters.minQty}).`;
      updateIntentStatus(intentId, "failed", reason);
      return { ok: false, status: "failed", reason };
    }
    if (filters.minNotional > 0 && qty * price < filters.minNotional) {
      const reason = `قيمة الصفقة أقل من الحد الأدنى (${filters.minNotional}).`;
      updateIntentStatus(intentId, "failed", reason);
      return { ok: false, status: "failed", reason };
    }

    // 4) Place the order on the user's environment (Testnet by default).
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

    const trade = recordTrade(userId, {
      intent_id: intentId,
      symbol: intent.symbol,
      side: intent.side,
      qty: executedQty,
      quote_qty: quoteQty,
      avg_price: avgPrice,
      order_id: String(order.orderId),
      env: creds.env,
      status: "open",
    });

    updateIntentStatus(intentId, "executed", `نُفّذت (طلب #${order.orderId}).`);
    return { ok: true, status: "executed", reason: "تم التنفيذ.", tradeId: trade.id };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "فشل تنفيذ الأمر.";
    updateIntentStatus(intentId, "failed", reason);
    return { ok: false, status: "failed", reason };
  }
}
