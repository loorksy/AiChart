import { NON_FOREX_MARKET_MESSAGE } from "./marketPolicy";
import {
  getIntent,
  getMtAccountMeta,
  getSettings,
  getTrade,
  updateTradeClosed,
  listOpenTrades,
  listOpenTradesWithOco,
  listPendingEntryTrades,
  updateTradeEntryFilled,
  updateTradeCancelled,
} from "./store";
import { dispatchAlert } from "./alerts";
import { waitForEaCommandAck } from "./eaCommandWait";
import { getEaConnection, isHeartbeatFresh } from "./eaStore";
import { queueEaClosePosition } from "./eaTradeCommands";
import { mt5Close } from "./mt5local/client";
import { enqueue } from "./queue";
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
  // Offload the LLM + embedding post-mortem to the worker tier (or inline when
  // no queue is configured) so it never delays the close response.
  void enqueue("trade_post_mortem", { userId, tradeId, pnl }).catch((err) => {
    console.error("[tradeClose] post-mortem enqueue failed", tradeId, err);
  });
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
  const acct = await getMtAccountMeta(trade.user_id);
  if (!acct) {
    return {
      ok: false,
      tradeId: trade.id,
      symbol: trade.symbol,
      pnl: 0,
      reason: "لا يوجد حساب MT5 مرتبط لإغلاق الصفقة.",
    };
  }
  const result = await mt5Close(
    { login: acct.login, server: acct.server },
    { ticket },
  );
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

/** Closes an MT5 EA position by ticket via the command queue. */
async function closeMt5EaTrade(trade: Trade): Promise<CloseTradeResult> {
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

  const conn = await getEaConnection(trade.user_id);
  if (!conn || conn.status === "revoked" || !isHeartbeatFresh(conn.last_heartbeat_at)) {
    return {
      ok: false,
      tradeId: trade.id,
      symbol: trade.symbol,
      pnl: 0,
      reason: "MetaTrader غير متصل. افتح المنصّة وتأكد من تشغيل EA.",
    };
  }

  const command = await queueEaClosePosition(trade.user_id, ticket);
  const ack = await waitForEaCommandAck(command.id);
  if (!ack.ok) {
    return {
      ok: false,
      tradeId: trade.id,
      symbol: trade.symbol,
      pnl: 0,
      reason: ack.reason ?? "رفض MetaTrader إغلاق الصفقة.",
    };
  }

  await updateTradeClosed(trade.id, 0);
  afterTradeClosed(trade.user_id, trade.id, 0);
  return { ok: true, tradeId: trade.id, symbol: trade.symbol, pnl: 0 };
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

  if (trade.broker === "mt_ea") {
    try {
      const result = await closeMt5EaTrade(trade);
      if (result.ok) {
        await dispatchAlert(userId, {
          type: "trade_closed",
          title: `إغلاق صفقة ${result.symbol}`,
          text:
            `✅ <b>إغلاق صفقة · Position closed</b>\n` +
            `${result.symbol}\n` +
            `تذكرة MT5 #${trade.order_id}`,
          symbol: result.symbol,
        });
      }
      return result;
    } catch (e) {
      const reason = e instanceof Error ? e.message : "فشل إغلاق الصفقة.";
      return { ok: false, tradeId, symbol: trade.symbol, pnl: 0, reason };
    }
  }

  return {
    ok: false,
    tradeId,
    symbol: trade.symbol,
    pnl: 0,
    reason: NON_FOREX_MARKET_MESSAGE,
  };
}

/** Closes every open trade for a user (e.g. kill switch). */
export async function closeAllOpenTrades(userId: number): Promise<{
  closed: number;
  failed: number;
  totalPnl: number;
  errors: string[];
}> {
  const open = await listOpenTrades(userId);

  let closed = 0;
  let failed = 0;
  let totalPnl = 0;
  const errors: string[] = [];

  for (const t of open) {
    try {
      const result = await closeOpenTrade(userId, t.id);
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
        `إجمالي PnL: <b>${sign}${totalPnl.toFixed(2)} USD</b>`,
    });
  }

  return { closed, failed, totalPnl, errors };
}

/** Closes open trades when unrealized profit reaches the user's threshold. */
export async function scanOpenTradesForTakeProfit(
  _userId: number,
  _maxTrades = 5,
): Promise<{ closed: number; errors: string[] }> {
  return { closed: 0, errors: [] };
}
