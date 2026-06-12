import {
  getBinanceCredentials,
  getIntent,
  getSettings,
  getTrade,
  updateTradeClosed,
  listOpenTrades,
  listOpenTradesWithOco,
  listPendingEntryTrades,
  updateTradeEntryFilled,
  updateTradeCancelled,
} from "./store";
import {
  getPrice,
  getSymbolFilters,
  roundToStep,
  roundToTick,
  placeMarketOrder,
  getOcoOrderList,
  type BinanceEnv,
} from "./binance";
import {
  cancelAllFuturesOrders,
  getFuturesOrder,
  getFuturesPositions,
  getFuturesPrice,
  getFuturesSymbolFilters,
  placeFuturesExitOrder,
  placeFuturesMarketOrder,
} from "./binanceFutures";
import { dispatchAlert } from "./alerts";
import { mt5Close } from "./mt5local/client";
import { runTradePostMortem } from "./tradePostMortem";
import type { Trade } from "./types";

export interface CloseTradeResult {
  ok: boolean;
  tradeId: number;
  symbol: string;
  pnl: number;
  reason?: string;
}

function computePnl(
  side: string,
  qty: number,
  quoteQty: number,
  exitPrice: number,
  exitQty: number,
): number {
  const exitQuote = exitPrice * exitQty;
  if (side === "buy") {
    return exitQuote - quoteQty;
  }
  return quoteQty - exitQuote;
}

function afterTradeClosed(userId: number, tradeId: number, pnl: number): void {
  void runTradePostMortem(userId, tradeId, pnl).catch((err) => {
    console.error("[tradeClose] post-mortem failed", tradeId, err);
  });
}

/** Closes a futures position: cancel SL/TP orders, then reduce-only market. */
async function closeFuturesTrade(
  trade: Trade,
  creds: { apiKey: string; apiSecret: string; env: BinanceEnv },
): Promise<CloseTradeResult> {
  const closeSide = trade.side === "buy" ? "SELL" : "BUY";
  const filters = await getFuturesSymbolFilters(trade.symbol, creds.env);
  const qty = roundToStep(trade.qty, filters.stepSize);
  if (qty <= 0) {
    return {
      ok: false,
      tradeId: trade.id,
      symbol: trade.symbol,
      pnl: 0,
      reason: "كمية غير صالحة للإغلاق.",
    };
  }

  // Remove protective orders first so closePosition doesn't conflict.
  await cancelAllFuturesOrders(
    creds.apiKey,
    creds.apiSecret,
    creds.env,
    trade.symbol,
  ).catch(() => {});

  const order = await placeFuturesMarketOrder(
    creds.apiKey,
    creds.apiSecret,
    creds.env,
    trade.symbol,
    closeSide,
    qty,
    true, // reduceOnly
  );

  const executedQty = Number(order.executedQty) || qty;
  const exitPrice =
    Number(order.avgPrice) ||
    (Number(order.cumQuote) > 0 ? Number(order.cumQuote) / executedQty : 0);
  // quote_qty stores position notional (entry price × qty).
  const pnl = computePnl(
    trade.side,
    trade.qty,
    trade.quote_qty,
    exitPrice,
    executedQty,
  );

  await updateTradeClosed(trade.id, pnl);
  afterTradeClosed(trade.user_id, trade.id, pnl);
  return { ok: true, tradeId: trade.id, symbol: trade.symbol, pnl };
}

async function closeOneTrade(
  userId: number,
  tradeId: number,
  creds: { apiKey: string; apiSecret: string; env: BinanceEnv },
): Promise<CloseTradeResult> {
  const trade = await getTrade(userId, tradeId);
  if (!trade) {
    return { ok: false, tradeId, symbol: "", pnl: 0, reason: "الصفقة غير موجودة." };
  }
  if (trade.status !== "open") {
    return {
      ok: false,
      tradeId,
      symbol: trade.symbol,
      pnl: 0,
      reason: "الصفقة مغلقة مسبقاً.",
    };
  }

  if (trade.market_type === "futures") {
    return closeFuturesTrade(trade, creds);
  }

  const closeSide = trade.side === "buy" ? "SELL" : "BUY";
  const [price, filters] = await Promise.all([
    getPrice(trade.symbol, creds.env),
    getSymbolFilters(trade.symbol, creds.env),
  ]);
  const qty = roundToStep(trade.qty, filters.stepSize);

  if (qty < filters.minQty || qty <= 0) {
    return {
      ok: false,
      tradeId,
      symbol: trade.symbol,
      pnl: 0,
      reason: `الكمية أقل من الحد الأدنى (${filters.minQty}).`,
    };
  }

  const order = await placeMarketOrder(
    creds.apiKey,
    creds.apiSecret,
    creds.env,
    trade.symbol,
    closeSide,
    qty,
  );

  const executedQty = Number(order.executedQty) || qty;
  const exitQuote = Number(order.cummulativeQuoteQty) || executedQty * price;
  const exitPrice = executedQty > 0 ? exitQuote / executedQty : price;
  const pnl = computePnl(
    trade.side,
    trade.qty,
    trade.quote_qty,
    exitPrice,
    executedQty,
  );

  await updateTradeClosed(tradeId, pnl);
  afterTradeClosed(userId, tradeId, pnl);
  return { ok: true, tradeId, symbol: trade.symbol, pnl };
}

/** Closes an MT5-bridge position by its ticket and records realized PnL. */
async function closeMt5LocalTrade(
  trade: Trade,
): Promise<CloseTradeResult> {
  const ticket = Number(trade.order_id);
  if (!Number.isFinite(ticket) || ticket <= 0) {
    return {
      ok: false,
      tradeId: trade.id,
      symbol: trade.symbol,
      pnl: 0,
      reason: "لا توجد تذكرة MT5 مسجلة لهذه الصفقة.",
    };
  }
  const result = await mt5Close({ ticket });
  if (!result.ok || result.closed.length === 0) {
    return {
      ok: false,
      tradeId: trade.id,
      symbol: trade.symbol,
      pnl: 0,
      reason: result.errors.join("، ") || "رفض MT5 إغلاق الصفقة.",
    };
  }
  const pnl = result.closed.reduce((sum, c) => sum + (Number(c.profit) || 0), 0);
  await updateTradeClosed(trade.id, pnl);
  afterTradeClosed(trade.user_id, trade.id, pnl);
  return { ok: true, tradeId: trade.id, symbol: trade.symbol, pnl };
}

/** Closes an open trade with the opposite market order and records PnL. */
export async function closeOpenTrade(
  userId: number,
  tradeId: number,
): Promise<CloseTradeResult> {
  const trade = await getTrade(userId, tradeId);
  if (!trade) {
    return { ok: false, tradeId, symbol: "", pnl: 0, reason: "الصفقة غير موجودة." };
  }

  if (trade.broker === "mt5_local") {
    try {
      const result = await closeMt5LocalTrade(trade);
      if (result.ok) {
        const sign = result.pnl >= 0 ? "+" : "";
        await dispatchAlert(userId, {
          type: "trade_closed",
          title: `إغلاق صفقة ${result.symbol}`,
          text:
            `✅ <b>إغلاق صفقة · Position closed</b>\n` +
            `${result.symbol}\n` +
            `PnL: <b>${sign}${result.pnl.toFixed(2)}</b>`,
          symbol: result.symbol,
        });
      }
      return result;
    } catch (e) {
      const reason = e instanceof Error ? e.message : "فشل إغلاق الصفقة.";
      return { ok: false, tradeId, symbol: trade.symbol, pnl: 0, reason };
    }
  }

  const creds = await getBinanceCredentials(userId);
  if (!creds) {
    return {
      ok: false,
      tradeId,
      symbol: "",
      pnl: 0,
      reason: "لا يوجد حساب Binance مرتبط.",
    };
  }

  try {
    const result = await closeOneTrade(userId, tradeId, creds);
    if (result.ok) {
      const sign = result.pnl >= 0 ? "+" : "";
      await dispatchAlert(userId, {
        type: "trade_closed",
        title: `إغلاق صفقة ${result.symbol}`,
        text:
          `✅ <b>إغلاق صفقة · Position closed</b>\n` +
          `${result.symbol}\n` +
          `PnL: <b>${sign}${result.pnl.toFixed(2)} USDT</b>`,
        symbol: result.symbol,
      });
    }
    return result;
  } catch (e) {
    const reason = e instanceof Error ? e.message : "فشل إغلاق الصفقة.";
    return { ok: false, tradeId, symbol: "", pnl: 0, reason };
  }
}

/** Closes every open trade for a user (e.g. kill switch). */
export async function closeAllOpenTrades(userId: number): Promise<{
  closed: number;
  failed: number;
  totalPnl: number;
  errors: string[];
}> {
  const open = await listOpenTrades(userId);
  const creds = await getBinanceCredentials(userId);
  if (!creds && open.some((t) => t.broker !== "mt5_local")) {
    return { closed: 0, failed: 0, totalPnl: 0, errors: ["لا يوجد حساب Binance."] };
  }

  let closed = 0;
  let failed = 0;
  let totalPnl = 0;
  const errors: string[] = [];

  for (const t of open) {
    try {
      const result =
        t.broker === "mt5_local"
          ? await closeMt5LocalTrade(t)
          : await closeOneTrade(userId, t.id, creds!);
      if (result.ok) {
        closed++;
        totalPnl += result.pnl;
      } else {
        failed++;
        errors.push(`${t.symbol}: ${result.reason ?? "فشل"}`);
      }
    } catch (e) {
      failed++;
      errors.push(
        `${t.symbol}: ${e instanceof Error ? e.message : "خطأ"}`,
      );
    }
  }

  if (closed > 0) {
    const sign = totalPnl >= 0 ? "+" : "";
    await dispatchAlert(userId, {
      type: "trade_closed",
      title: `إغلاق طارئ لـ ${closed} صفقة`,
      text:
        `🛑 <b>إغلاق طارئ · Emergency close</b>\n` +
        `أُغلقت ${closed} صفقة.\n` +
        `إجمالي PnL: <b>${sign}${totalPnl.toFixed(2)} USDT</b>`,
    });
  }

  return { closed, failed, totalPnl, errors };
}

function unrealizedPnl(trade: Trade, currentPrice: number): number {
  const marketValue = trade.qty * currentPrice;
  if (trade.side === "buy") return marketValue - trade.quote_qty;
  return trade.quote_qty - marketValue;
}

/** Closes open trades when unrealized profit reaches the user's threshold. */
export async function scanOpenTradesForTakeProfit(
  userId: number,
  maxTrades = 5,
): Promise<{ closed: number; errors: string[] }> {
  const settings = await getSettings(userId);
  const threshold = settings.auto_take_profit_usd;
  if (threshold <= 0) return { closed: 0, errors: [] };

  const creds = await getBinanceCredentials(userId);
  if (!creds) return { closed: 0, errors: ["لا يوجد حساب Binance."] };

  const open = (await listOpenTrades(userId, maxTrades)).filter(
    (t) => !t.oco_order_list_id,
  );
  let closed = 0;
  const errors: string[] = [];

  for (const trade of open) {
    try {
      const price = await getPrice(trade.symbol, creds.env);
      const pnl = unrealizedPnl(trade, price);
      if (pnl < threshold) continue;

      const result = await closeOneTrade(userId, trade.id, creds);
      if (result.ok) {
        closed++;
        const sign = result.pnl >= 0 ? "+" : "";
        await dispatchAlert(userId, {
          type: "trade_closed",
          title: `جني ربح تلقائي · ${result.symbol}`,
          text:
            `💰 <b>إغلاق تلقائي على ربح</b>\n` +
            `${result.symbol}\n` +
            `PnL: <b>${sign}${result.pnl.toFixed(2)} USDT</b>`,
          symbol: result.symbol,
        });
      } else if (result.reason) {
        errors.push(`${trade.symbol}: ${result.reason}`);
      }
    } catch (e) {
      errors.push(
        `${trade.symbol}: ${e instanceof Error ? e.message : "خطأ"}`,
      );
    }
  }

  return { closed, errors };
}

/**
 * Syncs DB when futures positions were closed externally (SL/TP triggered,
 * liquidation, or manual close on Binance). An open DB trade whose exchange
 * position no longer exists is marked closed with mark-price PnL.
 */
export async function syncFuturesClosures(
  userId: number,
  maxTrades = 5,
): Promise<{ synced: number; errors: string[] }> {
  const creds = await getBinanceCredentials(userId);
  if (!creds) return { synced: 0, errors: ["لا يوجد حساب Binance."] };

  const open = (await listOpenTrades(userId, maxTrades * 4))
    .filter((t) => t.market_type === "futures")
    .slice(0, maxTrades);
  if (open.length === 0) return { synced: 0, errors: [] };

  let synced = 0;
  const errors: string[] = [];
  let positions: Awaited<ReturnType<typeof getFuturesPositions>>;
  try {
    positions = await getFuturesPositions(
      creds.apiKey,
      creds.apiSecret,
      creds.env,
    );
  } catch (e) {
    return {
      synced: 0,
      errors: [e instanceof Error ? e.message : "فشل جلب مراكز Futures."],
    };
  }

  for (const trade of open) {
    try {
      const live = positions.find((p) => p.symbol === trade.symbol);
      if (live) continue; // still open on the exchange

      // Position is gone — closed by SL/TP/liquidation/manual close.
      const price = await getFuturesPrice(trade.symbol, creds.env);
      const pnl = computePnl(
        trade.side,
        trade.qty,
        trade.quote_qty,
        price,
        trade.qty,
      );
      await updateTradeClosed(trade.id, pnl);
      afterTradeClosed(trade.user_id, trade.id, pnl);
      // Clean up any orphaned protective orders.
      await cancelAllFuturesOrders(
        creds.apiKey,
        creds.apiSecret,
        creds.env,
        trade.symbol,
      ).catch(() => {});
      synced++;
      const sign = pnl >= 0 ? "+" : "";
      await dispatchAlert(userId, {
        type: "trade_closed",
        title: `إغلاق مركز Futures · ${trade.symbol}`,
        text:
          `✅ <b>أُغلق مركز Futures</b>\n` +
          `${trade.symbol} (${trade.side === "buy" ? "Long" : "Short"} ${trade.leverage ?? 1}x)\n` +
          `PnL تقريبي: <b>${sign}${pnl.toFixed(2)} USDT</b>`,
        symbol: trade.symbol,
      });
    } catch (e) {
      errors.push(
        `${trade.symbol}: ${e instanceof Error ? e.message : "خطأ"}`,
      );
    }
  }

  return { synced, errors };
}

const CANCELLED_ORDER_STATUSES = new Set([
  "CANCELED",
  "CANCELLED",
  "EXPIRED",
  "REJECTED",
]);

async function placeFuturesProtectiveOrders(
  creds: { apiKey: string; apiSecret: string; env: BinanceEnv },
  symbol: string,
  side: "buy" | "sell",
  stopLoss: number | null | undefined,
  takeProfit: number | null | undefined,
): Promise<void> {
  const positionSide = side === "buy" ? "long" : "short";
  const filters = await getFuturesSymbolFilters(symbol, creds.env);
  if (stopLoss != null) {
    await placeFuturesExitOrder(
      creds.apiKey,
      creds.apiSecret,
      creds.env,
      symbol,
      positionSide,
      "stop_loss",
      roundToTick(stopLoss, filters.tickSize),
    );
  }
  if (takeProfit != null) {
    await placeFuturesExitOrder(
      creds.apiKey,
      creds.apiSecret,
      creds.env,
      symbol,
      positionSide,
      "take_profit",
      roundToTick(takeProfit, filters.tickSize),
    );
  }
}

/**
 * When a futures Limit entry order fills, promote pending_entry → open and
 * attach SL/TP from the originating intent.
 */
export async function syncFuturesLimitFills(
  userId: number,
  maxTrades = 5,
): Promise<{ synced: number; errors: string[] }> {
  const creds = await getBinanceCredentials(userId);
  if (!creds) return { synced: 0, errors: ["لا يوجد حساب Binance."] };

  const pending = await listPendingEntryTrades(userId, maxTrades);
  if (pending.length === 0) return { synced: 0, errors: [] };

  let positions: Awaited<ReturnType<typeof getFuturesPositions>>;
  try {
    positions = await getFuturesPositions(
      creds.apiKey,
      creds.apiSecret,
      creds.env,
    );
  } catch (e) {
    return {
      synced: 0,
      errors: [e instanceof Error ? e.message : "فشل جلب مراكز Futures."],
    };
  }

  let synced = 0;
  const errors: string[] = [];

  for (const trade of pending) {
    if (!trade.order_id) continue;
    try {
      const orderId = Number(trade.order_id);
      const order = await getFuturesOrder(
        creds.apiKey,
        creds.apiSecret,
        creds.env,
        trade.symbol,
        orderId,
      );
      const status = String(order.status ?? "").toUpperCase();

      if (CANCELLED_ORDER_STATUSES.has(status)) {
        await updateTradeCancelled(trade.id);
        await dispatchAlert(userId, {
          type: "trade_failed",
          title: `إلغاء Limit · ${trade.symbol}`,
          text: `❌ <b>أُلغي أمر Limit</b>\n${trade.symbol} · طلب #${orderId}`,
          symbol: trade.symbol,
        });
        synced++;
        continue;
      }

      const live = positions.find((p) => p.symbol === trade.symbol);
      const filled =
        status === "FILLED" ||
        (live != null && Math.abs(live.positionAmt) > 0);

      if (!filled) continue;

      const intent = trade.intent_id
        ? await getIntent(trade.intent_id)
        : null;
      const executedQty =
        Number(order.executedQty) > 0
          ? Number(order.executedQty)
          : live
            ? Math.abs(live.positionAmt)
            : trade.qty;
      const avgPrice =
        Number(order.avgPrice) > 0
          ? Number(order.avgPrice)
          : live?.entryPrice ?? trade.avg_price;
      const quoteQty = Number(order.cumQuote) || executedQty * avgPrice;

      await updateTradeEntryFilled(
        trade.id,
        executedQty,
        quoteQty,
        avgPrice,
      );

      if (intent) {
        await placeFuturesProtectiveOrders(
          creds,
          trade.symbol,
          trade.side as "buy" | "sell",
          intent.stop_loss,
          intent.take_profit,
        );
      }

      synced++;
      await dispatchAlert(userId, {
        type: "trade_executed",
        title: `تعبئة Limit · ${trade.symbol}`,
        text:
          `✅ <b>تعبّأ أمر Limit Futures</b>\n` +
          `${trade.symbol} · ${executedQty} @ ${avgPrice}`,
        symbol: trade.symbol,
      });
    } catch (e) {
      errors.push(
        `${trade.symbol}: ${e instanceof Error ? e.message : "خطأ"}`,
      );
    }
  }

  return { synced, errors };
}

/** Syncs DB when Binance OCO orders have filled. */
export async function syncOcoFills(
  userId: number,
  maxTrades = 5,
): Promise<{ synced: number; errors: string[] }> {
  const creds = await getBinanceCredentials(userId);
  if (!creds) return { synced: 0, errors: ["لا يوجد حساب Binance."] };

  const trades = await listOpenTradesWithOco(userId, maxTrades);
  let synced = 0;
  const errors: string[] = [];

  for (const trade of trades) {
    if (!trade.oco_order_list_id) continue;
    try {
      const oco = await getOcoOrderList(
        creds.apiKey,
        creds.apiSecret,
        creds.env,
        trade.oco_order_list_id,
      );
      if (oco.listStatusType !== "ALL_DONE") continue;

      const filled = oco.orders.find((o) => o.status === "FILLED");
      if (!filled) continue;

      const executedQty = Number(filled.executedQty) || trade.qty;
      const exitQuote =
        Number(filled.cummulativeQuoteQty) || executedQty * Number(filled.price);
      const exitPrice =
        executedQty > 0 ? exitQuote / executedQty : Number(filled.price);
      const pnl = computePnl(
        trade.side,
        trade.qty,
        trade.quote_qty,
        exitPrice,
        executedQty,
      );

      await updateTradeClosed(trade.id, pnl);
      afterTradeClosed(trade.user_id, trade.id, pnl);
      synced++;
      const sign = pnl >= 0 ? "+" : "";
      await dispatchAlert(userId, {
        type: "trade_closed",
        title: `إغلاق OCO · ${trade.symbol}`,
        text:
          `✅ <b>إغلاق عبر OCO · Position closed</b>\n` +
          `${trade.symbol}\n` +
          `PnL: <b>${sign}${pnl.toFixed(2)} USDT</b>`,
        symbol: trade.symbol,
      });
    } catch (e) {
      errors.push(
        `${trade.symbol}: ${e instanceof Error ? e.message : "خطأ"}`,
      );
    }
  }

  return { synced, errors };
}
