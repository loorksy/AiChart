import { getSettings, listUsersForTradeMaintenance } from "./store";
import {
  scanOpenTradesForTakeProfit,
  syncFuturesClosures,
  syncFuturesLimitFills,
  syncOcoFills,
} from "./tradeClose";

const MAX_USERS = 8;
const MAX_TRADES_PER_USER = 5;

export interface CronPostScanResult {
  usersProcessed: number;
  ocoSynced: number;
  autoClosed: number;
  errors: string[];
}

/** OCO sync + auto take-profit for one user (MCP maintenance tool). */
export async function runUserPostScan(
  userId: number,
): Promise<CronPostScanResult> {
  const result: CronPostScanResult = {
    usersProcessed: 1,
    ocoSynced: 0,
    autoClosed: 0,
    errors: [],
  };

  const settings = await getSettings(userId);

  try {
    const oco = await syncOcoFills(userId, MAX_TRADES_PER_USER);
    result.ocoSynced += oco.synced;
    result.errors.push(...oco.errors.map((e) => `user ${userId} oco: ${e}`));

    const limit = await syncFuturesLimitFills(userId, MAX_TRADES_PER_USER);
    result.ocoSynced += limit.synced;
    result.errors.push(
      ...limit.errors.map((e) => `user ${userId} limit: ${e}`),
    );

    const fut = await syncFuturesClosures(userId, MAX_TRADES_PER_USER);
    result.ocoSynced += fut.synced;
    result.errors.push(
      ...fut.errors.map((e) => `user ${userId} futures: ${e}`),
    );

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

/** OCO sync + auto take-profit after the monitor cycle (batched). */
export async function runCronPostScan(): Promise<CronPostScanResult> {
  const result: CronPostScanResult = {
    usersProcessed: 0,
    ocoSynced: 0,
    autoClosed: 0,
    errors: [],
  };

  const users = await listUsersForTradeMaintenance(MAX_USERS);
  result.usersProcessed = users.length;

  for (const { id: userId } of users) {
    const one = await runUserPostScan(userId);
    result.ocoSynced += one.ocoSynced;
    result.autoClosed += one.autoClosed;
    result.errors.push(...one.errors);
  }

  return result;
}
