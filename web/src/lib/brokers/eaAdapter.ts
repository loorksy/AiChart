import {
  createEaCommand,
  getEaConnection,
  getEaSymbolSpec,
  isHeartbeatFresh,
} from "../eaStore";
import { waitForEaCommandAck, EA_ACK_TIMEOUT_MS } from "../eaCommandWait";
import { recordTrade, updateIntentStatus } from "../store";
import { computeForexLots } from "./lotSizing";
import { normalizeMt5Stops } from "./mt5Stops";
import { resolveMt5Symbol } from "../mt5SymbolMap";
import type { BrokerAdapter, OrderResult, PlaceOrderContext } from "./types";

/** Max time to wait for the EA to confirm a command before failing the order. */
const ACK_TIMEOUT_MS = EA_ACK_TIMEOUT_MS;

/** MetaTrader (MT4/MT5) execution backend via the self-hosted EA bridge. */
export const eaAdapter: BrokerAdapter = {
  kind: "mt_ea",

  async isConnected(userId: number): Promise<boolean> {
    const conn = await getEaConnection(userId);
    if (!conn || conn.status === "revoked") return false;
    return isHeartbeatFresh(conn.last_heartbeat_at);
  },

  notConnectedReason(): string {
    return "MetaTrader غير متصل. افتح المنصّة وتأكد من تشغيل EA وتفعيل التداول الآلي.";
  },

  async placeOrder(
    userId: number,
    { intent, push }: PlaceOrderContext,
  ): Promise<OrderResult> {
    push({ id: "creds", label: "التحقق من اتصال MetaTrader", status: "running" });
    const conn = await getEaConnection(userId);
    if (!conn || conn.status === "revoked" || !isHeartbeatFresh(conn.last_heartbeat_at)) {
      const reason = this.notConnectedReason();
      push({ id: "creds", label: "التحقق من اتصال MetaTrader", status: "error", detail: reason });
      await updateIntentStatus(intent.id, "failed", reason);
      return { ok: false, status: "failed", reason };
    }
    push({
      id: "creds",
      label: `MetaTrader متصل · ${conn.platform.toUpperCase()}${conn.broker_name ? ` · ${conn.broker_name}` : ""}`,
      status: "done",
    });

    const mt5Symbol = await resolveMt5Symbol(userId, intent.symbol);
    if (!mt5Symbol) {
      const reason = `الرمز ${intent.symbol} غير موجود في heartbeat MetaTrader — أضفه إلى Market Watch.`;
      push({ id: "quote", label: `الرمز · ${intent.symbol}`, status: "error", detail: reason });
      await updateIntentStatus(intent.id, "failed", reason);
      return { ok: false, status: "failed", reason };
    }

    // Size the order in lots from the EA-reported symbol spec.
    push({ id: "quote", label: `حساب حجم اللوت · ${mt5Symbol}`, status: "running" });
    const spec = await getEaSymbolSpec(userId, mt5Symbol);
    const sideQuote = intent.side === "buy" ? Number(spec?.ask) : Number(spec?.bid);
    const refPrice =
      (intent.entry ?? 0) ||
      sideQuote ||
      Number(spec?.ask) ||
      Number(spec?.bid) ||
      0;
    const sizing = computeForexLots(intent.notional, refPrice, spec);
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

    const stops = normalizeMt5Stops(
      intent.side,
      refPrice,
      intent.stop_loss,
      intent.take_profit,
      spec,
    );
    if (stops.note) {
      push({
        id: "stops",
        label: `ضبط SL/TP · ${intent.symbol}`,
        status: "done",
        detail: stops.note,
      });
    }

    if (!stops.stop_loss || stops.stop_loss <= 0) {
      const reason = "وقف الخسارة مطلوب لفتح الصفقة على MetaTrader.";
      push({
        id: "stops",
        label: `وقف الخسارة · ${intent.symbol}`,
        status: "error",
        detail: reason,
      });
      await updateIntentStatus(intent.id, "failed", reason);
      return { ok: false, status: "failed", reason };
    }

    // Queue the command for the EA and wait for its acknowledgement.
    const sideLabel = intent.side === "buy" ? "شراء" : "بيع";
    push({
      id: "order",
      label: `إرسال أمر ${sideLabel} · ${sizing.lots} لوت ${intent.symbol}`,
      status: "running",
    });
    const command = await createEaCommand(userId, {
      intent_id: intent.id,
      command_type: "open_market",
      payload: {
        symbol: mt5Symbol,
        side: intent.side,
        lots: sizing.lots,
        stop_loss: stops.stop_loss,
        take_profit: stops.take_profit,
      },
      ttlMs: ACK_TIMEOUT_MS,
    });

    const ack = await waitForEaCommandAck(command.id, ACK_TIMEOUT_MS);
    const finalStatus = ack.status;
    const result = ack.result;

    if (!ack.ok) {
      const reason = ack.reason ?? "رفض MetaTrader الأمر.";
      push({ id: "order", label: `إرسال أمر ${sideLabel} · ${intent.symbol}`, status: "error", detail: reason });
      await updateIntentStatus(intent.id, "failed", reason);
      return { ok: false, status: "failed", reason };
    }

    const ticket = result?.ticket != null ? String(result.ticket) : null;
    const fillPrice = Number(result?.price) || refPrice || 0;
    const filledLots = Number(result?.lots) || sizing.lots;

    const trade = await recordTrade(userId, {
      intent_id: intent.id,
      symbol: intent.symbol,
      side: intent.side,
      qty: filledLots,
      quote_qty: filledLots * fillPrice * (Number(spec?.contract_size) || 0),
      avg_price: fillPrice,
      order_id: ticket,
      env: conn.account_trade_mode === "live" ? "live" : "demo",
      market: "forex",
      broker: "mt_ea",
      status: "open",
    });

    push({
      id: "order",
      label: `تنفيذ ${sideLabel} · ${filledLots} لوت ${intent.symbol}`,
      status: "done",
      detail: ticket ? `تذكرة #${ticket}` : "نُفّذت",
    });
    push({ id: "record", label: "تسجيل الصفقة وإرسال الإشعار", status: "done" });

    await updateIntentStatus(
      intent.id,
      "executed",
      ticket ? `نُفّذت (تذكرة #${ticket}).` : "نُفّذت عبر MetaTrader.",
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
  },
};
