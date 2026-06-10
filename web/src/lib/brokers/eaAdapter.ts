import {
  createEaCommand,
  getEaCommand,
  getEaConnection,
  getEaSymbolSpec,
  isHeartbeatFresh,
} from "../eaStore";
import { recordTrade, updateIntentStatus } from "../store";
import { computeForexLots } from "./lotSizing";
import type { BrokerAdapter, OrderResult, PlaceOrderContext } from "./types";

/** Max time to wait for the EA to confirm a command before failing the order. */
const ACK_TIMEOUT_MS = 30_000;
const ACK_POLL_MS = 1_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

    // Size the order in lots from the EA-reported symbol spec.
    push({ id: "quote", label: `حساب حجم اللوت · ${intent.symbol}`, status: "running" });
    const spec = await getEaSymbolSpec(userId, intent.symbol);
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
        symbol: intent.symbol,
        side: intent.side,
        lots: sizing.lots,
        stop_loss: intent.stop_loss ?? null,
        take_profit: intent.take_profit ?? null,
      },
      ttlMs: ACK_TIMEOUT_MS,
    });

    const deadline = Date.now() + ACK_TIMEOUT_MS;
    let result: Record<string, unknown> | null = null;
    let finalStatus: string = "sent";
    while (Date.now() < deadline) {
      await sleep(ACK_POLL_MS);
      const current = await getEaCommand(command.id);
      if (!current) break;
      if (current.status === "acked" || current.status === "failed") {
        finalStatus = current.status;
        try {
          result = current.result_json
            ? (JSON.parse(current.result_json) as Record<string, unknown>)
            : {};
        } catch {
          result = {};
        }
        break;
      }
      if (current.status === "expired") {
        finalStatus = "expired";
        break;
      }
    }

    if (finalStatus !== "acked") {
      const reason =
        finalStatus === "failed"
          ? `رفض MetaTrader الأمر${result?.error ? ` · ${String(result.error)}` : ""}`
          : "انتهت مهلة انتظار تنفيذ MetaTrader. تأكد من اتصال المنصّة.";
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
      env: conn.platform,
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
