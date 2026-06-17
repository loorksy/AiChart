import { createEaCommand } from "./eaStore";
import { waitForEaCommandAck, EA_ACK_TIMEOUT_MS } from "./eaCommandWait";
import type { EaCommand, EaCommandType, EaGetOhlcPayload } from "./types";

export async function queueEaCommandAndWait(
  userId: number,
  commandType: EaCommandType,
  payload: Record<string, unknown>,
  timeoutMs = EA_ACK_TIMEOUT_MS,
): Promise<{ ok: boolean; command: EaCommand; result: Record<string, unknown> | null; reason?: string }> {
  const command = await createEaCommand(userId, {
    command_type: commandType,
    payload,
    ttlMs: timeoutMs,
  });
  const ack = await waitForEaCommandAck(command.id, timeoutMs);
  return {
    ok: ack.ok,
    command,
    result: ack.result,
    reason: ack.reason,
  };
}

export async function queueEaGetOhlc(
  userId: number,
  payload: EaGetOhlcPayload,
  timeoutMs?: number,
) {
  return queueEaCommandAndWait(
    userId,
    "get_ohlc",
    {
      symbol: payload.symbol,
      timeframe: payload.timeframe,
      count: payload.count ?? 200,
    },
    timeoutMs,
  );
}
