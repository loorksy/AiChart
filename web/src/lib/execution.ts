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
import {
  emitActivity,
  type ActivityListener,
  type AgentActivity,
} from "./agentActivity";

export interface ExecutionResult {
  ok: boolean;
  status: "executed" | "failed";
  reason: string;
  tradeId?: number;
  trade?: {
    symbol: string;
    side: string;
    qty: number;
    avg_price: number;
    env: string;
  };
}

/**
 * Executes a pending/approved trade intent. The Risk Guard is the gate: no
 * order is sent unless every hard cap passes. Defaults to the user's Binance
 * environment (Testnet by default).
 */
export interface ExecuteIntentOptions {
  onActivity?: ActivityListener;
}

export async function executeIntent(
  userId: number,
  intentId: number,
  options?: ExecuteIntentOptions,
): Promise<ExecutionResult & { activities: AgentActivity[] }> {
  const onActivity = options?.onActivity;
  const activities: AgentActivity[] = [];
  const push = (activity: AgentActivity) => {
    const idx = activities.findIndex((a) => a.id === activity.id);
    if (idx >= 0) activities[idx] = activity;
    else activities.push(activity);
    emitActivity(onActivity, activity);
  };

  const intent = await getIntent(intentId);
  if (!intent || intent.user_id !== userId) {
    return { ok: false, status: "failed", reason: "الطلب غير موجود.", activities };
  }
  if (intent.status === "executed") {
    return { ok: false, status: "failed", reason: "سبق تنفيذ هذا الطلب.", activities };
  }

  push({
    id: "risk",
    label: `فحص حدود المخاطر · ${intent.symbol}`,
    status: "running",
  });

  const settings = await getSettings(userId);
  const limits = await getLimits(userId);

  const effectiveCapital =
    limits.max_capital_cap > 0
      ? Math.min(settings.max_capital, limits.max_capital_cap)
      : settings.max_capital;

  // 1) Risk Guard — the authority. Nothing executes if this denies.
  const explicitApproval =
    settings.mode === "advisory" && intent.status === "approved";

  const decision = evaluateTrade(settings, limits, {
    symbol: intent.symbol,
    side: intent.side,
    notional: intent.notional,
  }, {
    masterKill: await isMasterKillOn(),
    openTradesCount: await countOpenTrades(userId),
    todayRealizedPnlPct: await todayRealizedPnlPct(userId, effectiveCapital),
    explicitApproval,
  });

  if (!decision.ok) {
    push({
      id: "risk",
      label: `فحص حدود المخاطر · ${intent.symbol}`,
      status: "error",
      detail: decision.reason,
    });
    await updateIntentStatus(intentId, "failed", decision.reason);
    return { ok: false, status: "failed", reason: decision.reason, activities };
  }
  push({
    id: "risk",
    label: `فحص حدود المخاطر · ${intent.symbol}`,
    status: "done",
  });

  push({
    id: "creds",
    label: "التحقق من حساب Binance",
    status: "running",
  });

  const creds = await getBinanceCredentials(userId);
  if (!creds) {
    const reason = "لا يوجد حساب Binance مرتبط.";
    push({ id: "creds", label: "التحقق من حساب Binance", status: "error", detail: reason });
    await updateIntentStatus(intentId, "failed", reason);
    return { ok: false, status: "failed", reason, activities };
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
      getPrice(intent.symbol, "prod"),
      getSymbolFilters(intent.symbol, "prod"),
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
      await updateIntentStatus(intentId, "failed", reason);
      return { ok: false, status: "failed", reason, activities };
    }
    if (filters.minNotional > 0 && qty * price < filters.minNotional) {
      const reason = `قيمة الصفقة أقل من الحد الأدنى (${filters.minNotional}).`;
      await updateIntentStatus(intentId, "failed", reason);
      return { ok: false, status: "failed", reason, activities };
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

    push({
      id: "order",
      label: `إرسال أمر ${sideLabel} · ${qty} ${intent.symbol}`,
      status: "done",
      detail: `طلب #${order.orderId}`,
    });
    push({
      id: "record",
      label: "تسجيل الصفقة وإرسال الإشعار",
      status: "done",
    });

    await updateIntentStatus(intentId, "executed", `نُفّذت (طلب #${order.orderId}).`);
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
      activities,
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "فشل تنفيذ الأمر.";
    push({
      id: "order",
      label: "إرسال الأمر إلى Binance",
      status: "error",
      detail: reason,
    });
    await updateIntentStatus(intentId, "failed", reason);
    return { ok: false, status: "failed", reason, activities };
  }
}
