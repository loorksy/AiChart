import { runCronPostScan } from "./cronPostScan";
import { collectTradeWatchAlerts } from "./tradeWatch";
import { listUsersForMonitor } from "./store";
import { notifyUser } from "./telegram";

export interface MonitorCycleEvent {
  userId: number;
  type: "trade_alert";
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
      const alerts = await collectTradeWatchAlerts(userId);
      if (!alerts.length) continue;
      const detail = alerts.map((alert) => alert.detail).join("\n");
      let delivered = true;
      try {
        await notifyUser(userId, detail);
      } catch {
        delivered = false;
      }
      result.events.push({ userId, type: "trade_alert", detail, delivered });
    } catch (error) {
      result.errors.push(`user ${userId}: ${error instanceof Error ? error.message : "error"}`);
    }
  }
  return result;
}
