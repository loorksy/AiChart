
export interface CronPostScanResult {
  usersProcessed: number;
  autoClosed: number;
  errors: string[];
}

/** Compatibility maintenance result; policy-driven auto-close was removed. */
export async function runUserPostScan(
  userId: number,
): Promise<CronPostScanResult> {
  const result: CronPostScanResult = {
    usersProcessed: 1,
    autoClosed: 0,
    errors: [],
  };

  return result;
}

/** Auto take-profit after the monitor cycle (batched). */
export async function runCronPostScan(): Promise<CronPostScanResult> {
  const result: CronPostScanResult = {
    usersProcessed: 0,
    autoClosed: 0,
    errors: [],
  };

  return result;
}
