import { getSettings, listUsersForTradeMaintenance } from "./store";
import { scanOpenTradesForTakeProfit } from "./tradeClose";

const MAX_USERS = 8;
const MAX_TRADES_PER_USER = 5;

export interface CronPostScanResult {
  usersProcessed: number;
  autoClosed: number;
  errors: string[];
}

/** Auto take-profit scan for one user (MCP maintenance tool). */
export async function runUserPostScan(
  userId: number,
): Promise<CronPostScanResult> {
  const result: CronPostScanResult = {
    usersProcessed: 1,
    autoClosed: 0,
    errors: [],
  };

  const settings = await getSettings(userId);

  try {
    if (settings.auto_take_profit_usd > 0) {
      const tp = await scanOpenTradesForTakeProfit(userId, MAX_TRADES_PER_USER);
      result.autoClosed += tp.closed;
      result.errors.push(...tp.errors.map((e) => `user ${userId} tp: ${e}`));
    }
  } catch (e) {
    result.errors.push(
      `user ${userId}: ${e instanceof Error ? e.message : "error"}`,
    );
  }

  return result;
}

/** Auto take-profit after the monitor cycle (batched). */
export async function runCronPostScan(): Promise<CronPostScanResult> {
  const result: CronPostScanResult = {
    usersProcessed: 0,
    autoClosed: 0,
    errors: [],
  };

  const users = await listUsersForTradeMaintenance(MAX_USERS);
  result.usersProcessed = users.length;

  for (const { id: userId } of users) {
    const one = await runUserPostScan(userId);
    result.autoClosed += one.autoClosed;
    result.errors.push(...one.errors);
  }

  return result;
}
