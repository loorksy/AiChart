import { runCronPostScan } from "./cronPostScan";
import { monitorEaBridgeHealth } from "./eaHealthMonitor";
import { sampleLiveCosts } from "./strategies/liveCostProfile";
import { collectTradeWatchAlerts } from "./tradeWatch";
import { checkEconomicEventProximity } from "./recommendations/economicEventMonitor";
import { listUsersForMonitor } from "./store";
import { notifyUser } from "./telegram";
import { refreshAllStrategyDecay } from "./strategies/evidence";

export interface MonitorCycleEvent {
  userId: number;
  type:
    | "trade_alert"
    | "ea_offline"
    | "ea_recovered"
    | "strategy_promoted"
    | "strategy_suspended"
    | "economic_event";
  detail: string;
  delivered: boolean;
}

export interface MonitorCycleResult {
  users: number;
  maintenance: Awaited<ReturnType<typeof runCronPostScan>>;
  events: MonitorCycleEvent[];
  errors: string[];
}

/** Position maintenance and factual proximity alerts only; no market decisions. */
export async function runMonitorCycle(): Promise<MonitorCycleResult> {
  const users = await listUsersForMonitor();
  const result: MonitorCycleResult = {
    users: users.length,
    maintenance: await runCronPostScan(),
    events: [],
    errors: [],
  };
  for (const { id: userId } of users) {
    try {
      const eaEvent = await monitorEaBridgeHealth(userId);
      // Spread sampling piggybacks on the health check: the quotes are already
      // in memory, and ten-minute samples describe the session distribution as
      // well as a tick stream would (plan §13 H.1). Best-effort by design.
      await sampleLiveCosts(userId).catch(() => undefined);
      if (eaEvent) {
        let delivered = true;
        try {
          await notifyUser(userId, eaEvent.detail);
        } catch {
          delivered = false;
        }
        result.events.push({ userId, ...eaEvent, delivered });
      }
      const strategyEvents = await refreshAllStrategyDecay(userId);
      for (const strategyEvent of strategyEvents) {
        const deployment = strategyEvent.deployment;
        const detail =
          strategyEvent.event === "suspended"
            ? `تم تعليق الاستراتيجية ${deployment.strategyId} على ${deployment.symbol} ${deployment.timeframe}: ${deployment.suspendedReason ?? "انحراف الأداء الحي عن الاختبار التاريخي"}.`
            : `انتقلت الاستراتيجية ${deployment.strategyId} على ${deployment.symbol} ${deployment.timeframe} من الظل إلى الحالة النشطة بعد ${deployment.liveSampleSize} نتيجة مراقبة.`;
        let delivered = true;
        try {
          await notifyUser(userId, detail);
        } catch {
          delivered = false;
        }
        result.events.push({
          userId,
          type:
            strategyEvent.event === "suspended"
              ? "strategy_suspended"
              : "strategy_promoted",
          detail,
          delivered,
        });
      }
      // Calendar proximity (plan §8 C.6): a factual "release in N minutes"
      // alert for plans the operator holds, plus a re-evaluation trigger so the
      // brain — never the monitor — can re-decide. With no news provider this
      // produces nothing at all; delivery and dedupe live in the notifier.
      const economic = await checkEconomicEventProximity(userId).catch(() => null);
      if (economic?.events.length) {
        result.events.push({
          userId,
          type: "economic_event",
          detail: economic.events.map((event) => event.detail).join("\n"),
          delivered: economic.notify.delivered > 0,
        });
      }
      const alerts = await collectTradeWatchAlerts(userId);
      if (alerts.length) {
        const detail = alerts.map((alert) => alert.detail).join("\n");
        let delivered = true;
        try {
          await notifyUser(userId, detail);
        } catch {
          delivered = false;
        }
        result.events.push({ userId, type: "trade_alert", detail, delivered });
      }
    } catch (error) {
      result.errors.push(`user ${userId}: ${error instanceof Error ? error.message : "error"}`);
    }
  }
  return result;
}
