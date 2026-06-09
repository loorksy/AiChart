import {
  getBinanceCredentials,
  getTrade,
  updateTradeClosed,
  listOpenTrades,
} from "./store";
import {
  getPrice,
  getSymbolFilters,
  roundToStep,
  placeMarketOrder,
  type BinanceEnv,
} from "./binance";
import { dispatchAlert } from "./alerts";

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

/** Closes an open spot trade with the opposite market order and records PnL. */
export async function closeOpenTrade(
  userId: number,
  tradeId: number,
): Promise<CloseTradeResult> {
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
  const creds = await getBinanceCredentials(userId);
  if (!creds) {
    return { closed: 0, failed: 0, totalPnl: 0, errors: ["لا يوجد حساب Binance."] };
  }

  const open = await listOpenTrades(userId);
  let closed = 0;
  let failed = 0;
  let totalPnl = 0;
  const errors: string[] = [];

  for (const t of open) {
    try {
      const result = await closeOneTrade(userId, t.id, creds);
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
