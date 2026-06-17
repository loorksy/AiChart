import { createEaCommand, getEaConnection } from "./eaStore";
import { parseEaPositions } from "./executionEnv";
import { listOpenTrades } from "./store";
import type { EaCommand } from "./types";

export async function queueEaClosePosition(
  userId: number,
  ticket: number,
): Promise<EaCommand> {
  return createEaCommand(userId, {
    command_type: "close_position",
    payload: { ticket },
  });
}

export async function queueEaModifySlTp(
  userId: number,
  ticket: number,
  stopLoss: number,
  takeProfit?: number | null,
): Promise<EaCommand> {
  return createEaCommand(userId, {
    command_type: "modify_sl_tp",
    payload: {
      ticket,
      stop_loss: stopLoss,
      ...(takeProfit != null && takeProfit > 0
        ? { take_profit: takeProfit }
        : {}),
    },
  });
}

/** Queues close_position for every open mt_ea ticket (tracked + broker-only). */
export async function queueEaCloseAllPositions(
  userId: number,
): Promise<EaCommand[]> {
  const tickets = new Set<number>();

  for (const trade of await listOpenTrades(userId)) {
    if (trade.broker !== "mt_ea" || !trade.order_id) continue;
    const ticket = Number(trade.order_id);
    if (Number.isFinite(ticket) && ticket > 0) tickets.add(ticket);
  }

  const conn = await getEaConnection(userId);
  for (const pos of parseEaPositions(conn?.positions_json ?? null)) {
    if (pos.ticket > 0) tickets.add(pos.ticket);
  }

  const commands: EaCommand[] = [];
  for (const ticket of tickets) {
    commands.push(await queueEaClosePosition(userId, ticket));
  }
  return commands;
}

export const EA_KILL_CLOSE_FLAG_PREFIX = "ea_kill_close_";

export function eaKillCloseFlagKey(userId: number): string {
  return `${EA_KILL_CLOSE_FLAG_PREFIX}${userId}`;
}

export const EA_RECONNECT_FLAG_PREFIX = "ea_reconnect_";
export const EA_RESYNC_CANDLES_FLAG_PREFIX = "ea_resync_candles_";

export function eaReconnectFlagKey(userId: number): string {
  return `${EA_RECONNECT_FLAG_PREFIX}${userId}`;
}

export function eaResyncCandlesFlagKey(userId: number): string {
  return `${EA_RESYNC_CANDLES_FLAG_PREFIX}${userId}`;
}
