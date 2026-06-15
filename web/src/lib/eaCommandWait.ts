import { getEaCommand } from "./eaStore";
import { formatMt5TradeError } from "./brokers/mt5Retcode";

export const EA_ACK_TIMEOUT_MS = 30_000;
export const EA_ACK_POLL_MS = 1_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface EaCommandAckResult {
  ok: boolean;
  status: string;
  result: Record<string, unknown> | null;
  reason?: string;
}

/** Polls until the EA acks/fails a queued command or the timeout elapses. */
export async function waitForEaCommandAck(
  commandId: number,
  timeoutMs = EA_ACK_TIMEOUT_MS,
): Promise<EaCommandAckResult> {
  const deadline = Date.now() + timeoutMs;
  let result: Record<string, unknown> | null = null;
  let finalStatus = "sent";

  while (Date.now() < deadline) {
    await sleep(EA_ACK_POLL_MS);
    const current = await getEaCommand(commandId);
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

  if (finalStatus === "acked") {
    return { ok: true, status: finalStatus, result };
  }

  const rawErr = result?.error != null ? String(result.error) : "";
  const reason =
    finalStatus === "failed"
      ? rawErr
        ? formatMt5TradeError(rawErr)
        : "رفض MetaTrader الأمر."
      : "انتهت مهلة انتظار تنفيذ MetaTrader. تأكد من اتصال المنصّة.";

  return { ok: false, status: finalStatus, result, reason };
}
