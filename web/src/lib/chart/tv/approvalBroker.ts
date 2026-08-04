/**
 * Minimal TradingView Broker adapter: every placeOrder becomes a Lonora
 * approval request. Never calls a direct broker execution path.
 *
 * The Charting Library package may or may not surface Trading Platform UI
 * for this license — wiring is still the only legal path if buy/sell appears.
 */
import type {
  IBrokerConnectionAdapterHost,
  IBrokerTerminal,
  Order,
  PlaceOrderResult,
  PreOrder,
} from "@/vendor/tradingview/charting_library";

/** The only HTTP endpoint this adapter may call. */
export const TV_BROKER_APPROVAL_ENDPOINT = "/api/trades/request-approval";

/** Tools / endpoints the chart trade path must never hit. */
export const TV_BROKER_FORBIDDEN = [
  "/api/agent/trade/open",
  "open_trade",
  "executeIntent",
] as const;

export function createApprovalBroker(
  _host: IBrokerConnectionAdapterHost,
): IBrokerTerminal {
  return {
    async accountsMetainfo() {
      return [{ id: "lonora", name: "Lonora (approval)" }];
    },
    async currentAccount() {
      return "lonora";
    },
    async setCurrentAccount() {
      /* single account */
    },
    async chartContextMenuActions() {
      return [];
    },
    async isTradable() {
      return true;
    },
    async connectionStatus() {
      return 1; // Connected
    },
    async orders() {
      return [];
    },
    async positions() {
      return [];
    },
    async executions() {
      return [];
    },
    async symbolInfo(symbol: string) {
      return {
        qty: { min: 0.01, max: 100, step: 0.01 },
        pipValue: 1,
        pipSize: 0.0001,
        minTick: 0.00001,
        description: symbol,
      };
    },
    async placeOrder(order: PreOrder): Promise<PlaceOrderResult> {
      const side = Number(order.side) === 1 ? "buy" : "sell";
      const stopLoss =
        typeof order.stopLoss === "number" && order.stopLoss > 0
          ? order.stopLoss
          : undefined;
      const takeProfit =
        typeof order.takeProfit === "number" && order.takeProfit > 0
          ? order.takeProfit
          : undefined;
      // Approval only — human confirm is a separate step.
      const res = await fetch(TV_BROKER_APPROVAL_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: order.symbol,
          side,
          stop_loss: stopLoss,
          take_profit: takeProfit ?? null,
          qty: order.qty,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "approval request failed");
      }
      const data = (await res.json()) as { intentId?: number };
      return { orderId: String(data.intentId ?? `pending-${Date.now()}`) };
    },
    async modifyOrder(_order: Order): Promise<void> {
      throw new Error("Modify via approval queue — not from the chart");
    },
    async cancelOrder(_orderId: string): Promise<void> {
      throw new Error("Cancel via approval queue — not from the chart");
    },
    subscribeDO() {
      /* no depth */
    },
    unsubscribeDO() {
      /* no depth */
    },
    subscribeEquity() {
      /* equity lives in the Lonora top bar */
    },
    unsubscribeEquity() {
      /* */
    },
    subscribeMarginAvailable() {
      /* */
    },
    unsubscribeMarginAvailable() {
      /* */
    },
  } as unknown as IBrokerTerminal;
}
