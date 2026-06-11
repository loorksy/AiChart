import {
  getBinanceCredentials,
  getSettings,
  getTrade,
  updateTradeClosed,
  listOpenTrades,
  listOpenTradesWithOco,
} from "./store";
import {
  getPrice,
  getSymbolFilters,
  roundToStep,
  placeMarketOrder,
  getOcoOrderList,
  type BinanceEnv,
} from "./binance";
import { dispatchAlert } from "./alerts";
import { mt5Close } from "./mt5local/client";
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
