import { runCronPostScan } from "./cronPostScan";
import { checkEconomicEventProximity } from "./recommendations/economicEventMonitor";
import { listUsersForMonitor } from "./store";

export interface MonitorCycleEvent {
  userId: number;
  type: "economic_event";
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
      // The stop/target proximity alerts that used to run here watched OPEN
      // POSITIONS, read from a `trades` table only the deleted execution layer
      // could ever have written to. Every cycle queried an empty table and
      // announced nothing. Recommendation lifecycle alerts — the ones this
      // platform can actually observe — are raised by the lifecycle notifier.
    } catch (error) {
      result.errors.push(`user ${userId}: ${error instanceof Error ? error.message : "error"}`);
    }
  }
  return result;
}
