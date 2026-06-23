/**
 * Persistence for server-side strategy bots (grid/martingale). Separate from the
 * LLM agent: these are deterministic rule engines that run on the worker tier.
 */
import { execute, insertReturningId, query, queryOne } from "./db";
import type { GridConfig, GridLevel, GridSide } from "./strategies/gridBot";

export interface BotSessionRow {
  id: number;
  user_id: number;
  strategy: string;
  symbol: string;
  market: string;
  side: GridSide;
  config_json: string;
  state_json: string;
  status: "active" | "stopped";
  execution_mode: "paper" | "live";
  realized_pnl: number;
  stop_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface BotState {
  levels: GridLevel[];
  lastActionAt?: string;
}

export interface BotSession {
  id: number;
  userId: number;
  strategy: string;
  symbol: string;
  market: string;
  side: GridSide;
  config: GridConfig;
  state: BotState;
  status: "active" | "stopped";
  executionMode: "paper" | "live";
  realizedPnl: number;
  stopReason: string | null;
}

function parse(row: BotSessionRow): BotSession {
  return {
    id: row.id,
    userId: row.user_id,
    strategy: row.strategy,
    symbol: row.symbol,
    market: row.market,
    side: row.side,
    config: JSON.parse(row.config_json) as GridConfig,
    state: JSON.parse(row.state_json) as BotState,
    status: row.status,
    executionMode: row.execution_mode,
    realizedPnl: row.realized_pnl,
    stopReason: row.stop_reason,
  };
}

export async function createBotSession(
  userId: number,
  input: {
    strategy?: string;
    symbol: string;
    market: string;
    side: GridSide;
    config: GridConfig;
    executionMode: "paper" | "live";
  },
): Promise<BotSession> {
  const id = await insertReturningId(
    `INSERT INTO bot_sessions
      (user_id, strategy, symbol, market, side, config_json, state_json, status, execution_mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    [
      userId,
      input.strategy ?? "grid",
      input.symbol,
      input.market,
      input.side,
      JSON.stringify(input.config),
      JSON.stringify({ levels: [] } satisfies BotState),
      input.executionMode,
    ],
  );
  return (await getBotSession(id, userId))!;
}

export async function getBotSession(
  id: number,
  userId?: number,
): Promise<BotSession | null> {
  const row =
    userId != null
      ? await queryOne<BotSessionRow>(
          "SELECT * FROM bot_sessions WHERE id = ? AND user_id = ?",
          [id, userId],
        )
      : await queryOne<BotSessionRow>("SELECT * FROM bot_sessions WHERE id = ?", [
          id,
        ]);
  return row ? parse(row) : null;
}

export async function listUserBots(userId: number): Promise<BotSession[]> {
  const rows = await query<BotSessionRow>(
    "SELECT * FROM bot_sessions WHERE user_id = ? ORDER BY id DESC",
    [userId],
  );
  return rows.map(parse);
}

/** All active bots across users — the cron dispatch source. */
export async function listActiveBotSessions(): Promise<BotSession[]> {
  const rows = await query<BotSessionRow>(
    "SELECT * FROM bot_sessions WHERE status = 'active'",
    [],
  );
  return rows.map(parse);
}

export async function listActiveBotsForUser(
  userId: number,
): Promise<BotSession[]> {
  const rows = await query<BotSessionRow>(
    "SELECT * FROM bot_sessions WHERE status = 'active' AND user_id = ?",
    [userId],
  );
  return rows.map(parse);
}

export async function updateBotState(
  id: number,
  state: BotState,
  realizedPnlDelta = 0,
): Promise<void> {
  await execute(
    `UPDATE bot_sessions
       SET state_json = ?, realized_pnl = realized_pnl + ?, updated_at = datetime('now')
     WHERE id = ?`,
    [JSON.stringify(state), realizedPnlDelta, id],
  );
}

export async function stopBotSession(
  id: number,
  reason: string,
  userId?: number,
): Promise<void> {
  if (userId != null) {
    await execute(
      "UPDATE bot_sessions SET status = 'stopped', stop_reason = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [reason, id, userId],
    );
    return;
  }
  await execute(
    "UPDATE bot_sessions SET status = 'stopped', stop_reason = ?, updated_at = datetime('now') WHERE id = ?",
    [reason, id],
  );
}
