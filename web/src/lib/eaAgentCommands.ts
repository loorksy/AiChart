import { createEaCommand } from "./eaStore";
import { waitForEaCommandAck, EA_ACK_TIMEOUT_MS } from "./eaCommandWait";
import type { EaCommand, EaCommandType } from "./types";

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
