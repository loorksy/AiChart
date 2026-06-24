/**
 * Persistence for server-side strategy bots (grid / gold). Separate from the
 * LLM agent: these are deterministic rule engines that run on the worker tier.
 */
import { execute, insertReturningId, query, queryOne } from "./db";
import type { GridConfig, GridLevel, GridSide } from "./strategies/gridBot";
import type { GoldAgentXConfig, GoldAgentXState } from "./strategies/gold/goldTypes";
import { parseGoldAgentState, migrateGoldConfig } from "./strategies/gold/goldTypes";
import { defaultAdaptiveWeights } from "./strategies/gold/agentX/adaptiveWeights";
import { emptyPerformance } from "./strategies/gold/agentX/performanceEngine";

export type BotStrategy = "grid" | "gold";

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

export interface GridBotState {
  levels: GridLevel[];
  lastActionAt?: string;
}

export type BotState = GridBotState | GoldAgentXState;

export interface BotSession {
  id: number;
  userId: number;
  strategy: BotStrategy | string;
  symbol: string;
  market: string;
  side: GridSide;
  config: GridConfig | GoldAgentXConfig;
  state: BotState;
  status: "active" | "stopped";
  executionMode: "paper" | "live";
  realizedPnl: number;
  stopReason: string | null;
}

function parseConfig(strategy: string, raw: string): GridConfig | GoldAgentXConfig {
  const parsed = JSON.parse(raw) as GridConfig | GoldAgentXConfig | Record<string, unknown>;
  if (strategy === "gold") return migrateGoldConfig(parsed as Record<string, unknown>);
  return parsed as GridConfig;
}

function parseState(strategy: string, raw: string): BotState {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (strategy === "gold") {
    return parseGoldAgentState(parsed);
  }
  return {
    levels: (parsed.levels as GridLevel[]) ?? [],
    lastActionAt:
      typeof parsed.lastActionAt === "string" ? parsed.lastActionAt : undefined,
  } satisfies GridBotState;
}

function parse(row: BotSessionRow): BotSession {
  return {
    id: row.id,
    userId: row.user_id,
    strategy: row.strategy as BotStrategy,
    symbol: row.symbol,
    market: row.market,
    side: row.side,
    config: parseConfig(row.strategy, row.config_json),
    state: parseState(row.strategy, row.state_json),
    status: row.status,
    executionMode: row.execution_mode,
    realizedPnl: row.realized_pnl,
    stopReason: row.stop_reason,
  };
}

export async function createBotSession(
  userId: number,
  input: {
    strategy?: BotStrategy | string;
    symbol: string;
    market: string;
    side: GridSide;
    config: GridConfig | GoldAgentXConfig;
    executionMode: "paper" | "live";
  },
): Promise<BotSession> {
  const strategy = input.strategy ?? "grid";
  const id = await insertReturningId(
    `INSERT INTO bot_sessions
      (user_id, strategy, symbol, market, side, config_json, state_json, status, execution_mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    [
      userId,
      strategy,
      input.symbol,
      input.market,
      input.side,
      JSON.stringify(input.config),
      JSON.stringify({ levels: [], adaptiveWeights: defaultAdaptiveWeights() }),
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
