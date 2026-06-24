import { execute, insertReturningId, query, queryOne } from "./db";
import { forexCanonicalKey } from "./mt5SymbolMap";
import type { MtPlatform } from "./markets/types";
import type {
  EaCommand,
  EaCommandStatus,
  EaCommandType,
  EaConnection,
  EaConnectionMeta,
  EaStatus,
  EaSymbolSpec,
} from "./types";

/** Heartbeat freshness window. Older than this and the EA is considered offline. */
export const EA_HEARTBEAT_TIMEOUT_MS = 90_000;
/** Expected EA heartbeat interval — used for 3-strike debounce. */
export const EA_HEARTBEAT_INTERVAL_MS = 30_000;
/** Mark offline only after this many consecutive missed intervals. */
export const EA_HEARTBEAT_DEBOUNCE_MISSES = 3;
/** How long an unfetched command stays valid before it expires. */
export const EA_COMMAND_TTL_MS = 60_000;

interface EaDebounceState {
  settledOnlineSince: number | null;
}

const eaDebounceState = new Map<number, EaDebounceState>();

function parseTimestamp(value: string | null): number | null {
  if (!value) return null;
  // SQLite stores "YYYY-MM-DD HH:MM:SS" in UTC; normalize to ISO.
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export function isHeartbeatFresh(
  lastHeartbeatAt: string | null,
  timeoutMs = EA_HEARTBEAT_TIMEOUT_MS,
): boolean {
  const ms = parseTimestamp(lastHeartbeatAt);
  if (ms == null) return false;
  return Date.now() - ms <= timeoutMs;
}

/** Missed heartbeat slots from age (1 per interval after the first interval elapses). */
export function computeMissedHeartbeats(
  lastHeartbeatAt: string | null,
  intervalMs = EA_HEARTBEAT_INTERVAL_MS,
): number {
  const ms = parseTimestamp(lastHeartbeatAt);
  if (ms == null) return EA_HEARTBEAT_DEBOUNCE_MISSES;
  const age = Date.now() - ms;
  if (age <= intervalMs) return 0;
  return Math.min(
    EA_HEARTBEAT_DEBOUNCE_MISSES,
    Math.floor(age / intervalMs),
  );
}

export interface EaOnlineState {
  online: boolean;
  missedHeartbeats: number;
  settledOnlineSeconds: number;
}

function touchDebounceState(userId: number, online: boolean): EaDebounceState {
  let state = eaDebounceState.get(userId);
  if (!state) {
    state = { settledOnlineSince: online ? Date.now() : null };
    eaDebounceState.set(userId, state);
    return state;
  }
  if (online) {
    if (state.settledOnlineSince === null) {
      state.settledOnlineSince = Date.now();
    }
  } else {
    state.settledOnlineSince = null;
  }
  return state;
}

/** Debounced online state — offline only after 3 consecutive missed intervals. */
export function getEaOnlineState(
  userId: number,
  lastHeartbeatAt: string | null,
): EaOnlineState {
  const missedHeartbeats = computeMissedHeartbeats(lastHeartbeatAt);
  const online = missedHeartbeats < EA_HEARTBEAT_DEBOUNCE_MISSES;
  const state = touchDebounceState(userId, online);
  const settledOnlineSeconds = state.settledOnlineSince
    ? Math.floor((Date.now() - state.settledOnlineSince) / 1000)
    : 0;
  return { online, missedHeartbeats, settledOnlineSeconds };
}

export function isEaOnlineDebounced(
  userId: number,
  lastHeartbeatAt: string | null,
): boolean {
  return getEaOnlineState(userId, lastHeartbeatAt).online;
}

/** Called when a heartbeat is recorded — resets debounce strike count. */
export function resetEaHeartbeatDebounce(userId: number): void {
  eaDebounceState.set(userId, { settledOnlineSince: Date.now() });
}

export async function getEaConnection(
  userId: number,
): Promise<EaConnection | null> {
  return queryOne<EaConnection>(
    "SELECT * FROM ea_connections WHERE user_id = ?",
    [userId],
  );
}

export async function getEaConnectionByTokenHash(
  tokenHash: string,
): Promise<EaConnection | null> {
  return queryOne<EaConnection>(
    "SELECT * FROM ea_connections WHERE token_hash = ?",
    [tokenHash],
  );
}

/** Creates (or replaces) the user's EA connection with a fresh token hash. */
export async function upsertEaConnection(
  userId: number,
  platform: MtPlatform,
  tokenHash: string,
  label?: string | null,
): Promise<void> {
  await execute(
    `INSERT INTO ea_connections (user_id, platform, token_hash, label, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'offline', datetime('now'), datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       platform = excluded.platform,
       token_hash = excluded.token_hash,
       label = excluded.label,
       status = 'offline',
       updated_at = datetime('now')`,
    [userId, platform, tokenHash, label ?? null],
  );
}

export async function deleteEaConnection(userId: number): Promise<void> {
  await execute("DELETE FROM ea_connections WHERE user_id = ?", [userId]);
}

export async function setEaStatus(
  userId: number,
  status: EaStatus,
): Promise<void> {
  await execute(
    "UPDATE ea_connections SET status = ?, updated_at = datetime('now') WHERE user_id = ?",
    [status, userId],
  );
}

export interface EaHeartbeatPatch {
  broker_name?: string | null;
  account_login?: string | null;
  account_currency?: string | null;
  account_trade_mode?: string | null;
  balance?: number;
  equity?: number;
  symbol_specs_json?: string | null;
  positions_json?: string | null;
}

/**
 * Persists EA heartbeat. `symbol_specs_json` includes bid/ask read by the EA at
 * send time (~30s cadence) plus contract specs — not the /api/ea/quotes tick stream.
 * Do not use heartbeat bid/ask for trade execution pricing.
 */
export async function recordEaHeartbeat(
  userId: number,
  patch: EaHeartbeatPatch,
): Promise<void> {
  resetEaHeartbeatDebounce(userId);
  await execute(
    `UPDATE ea_connections SET
       broker_name = COALESCE(?, broker_name),
       account_login = COALESCE(?, account_login),
       account_currency = COALESCE(?, account_currency),
       account_trade_mode = COALESCE(?, account_trade_mode),
       balance = ?,
       equity = ?,
       symbol_specs_json = COALESCE(?, symbol_specs_json),
       positions_json = COALESCE(?, positions_json),
       status = 'online',
       last_heartbeat_at = datetime('now'),
       updated_at = datetime('now')
     WHERE user_id = ?`,
    [
      patch.broker_name ?? null,
      patch.account_login ?? null,
      patch.account_currency ?? null,
      patch.account_trade_mode ?? null,
      patch.balance ?? 0,
      patch.equity ?? 0,
      patch.symbol_specs_json ?? null,
      patch.positions_json ?? null,
      userId,
    ],
  );
}

export function toEaConnectionMeta(conn: EaConnection): EaConnectionMeta {
  const debounced =
    conn.status !== "revoked"
      ? getEaOnlineState(conn.user_id, conn.last_heartbeat_at)
      : { online: false, missedHeartbeats: EA_HEARTBEAT_DEBOUNCE_MISSES, settledOnlineSeconds: 0 };
  const online = debounced.online;
  return {
    id: conn.id,
    platform: conn.platform,
    label: conn.label,
    broker_name: conn.broker_name,
    account_login: conn.account_login,
    account_currency: conn.account_currency,
    balance: conn.balance,
    equity: conn.equity,
    status: online ? "online" : conn.status === "revoked" ? "revoked" : "offline",
    online,
    last_heartbeat_at: conn.last_heartbeat_at,
    account_trade_mode: conn.account_trade_mode ?? null,
    missedHeartbeats: debounced.missedHeartbeats,
    settledOnlineSeconds: debounced.settledOnlineSeconds,
  };
}

export async function getEaConnectionMeta(
  userId: number,
): Promise<EaConnectionMeta | null> {
  const conn = await getEaConnection(userId);
  return conn ? toEaConnectionMeta(conn) : null;
}

export function parseEaSymbolSpecs(json: string | null): EaSymbolSpec[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (Array.isArray(parsed)) return parsed as EaSymbolSpec[];
  } catch {
    /* ignore */
  }
  return [];
}

export async function getEaSymbolSpec(
  userId: number,
  symbol: string,
): Promise<EaSymbolSpec | null> {
  const conn = await getEaConnection(userId);
  if (!conn) return null;
  const specs = parseEaSymbolSpecs(conn.symbol_specs_json);
  const target = symbol.toUpperCase();
  return (
    specs.find((s) => s.symbol?.toUpperCase() === target) ?? null
  );
}

// ---------------------------------------------------------------------------
// EA commands queue
// ---------------------------------------------------------------------------

export async function createEaCommand(
  userId: number,
  cmd: {
    intent_id?: number | null;
    command_type: EaCommandType;
    payload: unknown;
    ttlMs?: number;
  },
): Promise<EaCommand> {
  const ttl = cmd.ttlMs ?? EA_COMMAND_TTL_MS;
  const id = await insertReturningId(
    `INSERT INTO ea_commands (user_id, intent_id, command_type, payload_json, status, created_at, expires_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', datetime('now'), datetime('now', ?), datetime('now'))`,
    [
      userId,
      cmd.intent_id ?? null,
      cmd.command_type,
      JSON.stringify(cmd.payload ?? {}),
      `+${Math.round(ttl / 1000)} seconds`,
    ],
  );
  return (await getEaCommand(id))!;
}

export async function getEaCommand(id: number): Promise<EaCommand | null> {
  return queryOne<EaCommand>("SELECT * FROM ea_commands WHERE id = ?", [id]);
}

export async function getEaCommandByIntent(
  intentId: number,
): Promise<EaCommand | null> {
  return queryOne<EaCommand>(
    "SELECT * FROM ea_commands WHERE intent_id = ? ORDER BY id DESC LIMIT 1",
    [intentId],
  );
}

/** Expires pending commands past their TTL, then returns the fresh queue. */
export async function fetchPendingEaCommands(
  userId: number,
  limit = 20,
): Promise<EaCommand[]> {
  await execute(
    `UPDATE ea_commands SET status = 'expired', updated_at = datetime('now')
     WHERE user_id = ? AND status = 'pending' AND expires_at IS NOT NULL
       AND expires_at < datetime('now')`,
    [userId],
  );
  const rows = await query<EaCommand>(
    `SELECT * FROM ea_commands WHERE user_id = ? AND status = 'pending' ORDER BY id ASC LIMIT ?`,
    [userId, limit],
  );
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(", ");
    await execute(
      `UPDATE ea_commands SET status = 'sent', updated_at = datetime('now')
       WHERE id IN (${placeholders})`,
      ids,
    );
  }
  return rows;
}

export async function ackEaCommand(
  id: number,
  userId: number,
  status: EaCommandStatus,
  result: unknown,
): Promise<EaCommand | null> {
  await execute(
    `UPDATE ea_commands SET status = ?, result_json = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
    [status, JSON.stringify(result ?? {}), id, userId],
  );
  return getEaCommand(id);
}

// ---------------------------------------------------------------------------
// EA market data cache (forex candles pushed by the EA)
// ---------------------------------------------------------------------------

export async function saveEaCandles(
  userId: number,
  symbol: string,
  interval: string,
  candlesJson: string,
): Promise<void> {
  await execute(
    `INSERT INTO ea_market_cache (user_id, symbol, interval, candles_json, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, symbol, interval) DO UPDATE SET
       candles_json = excluded.candles_json,
       updated_at = datetime('now')`,
    [userId, symbol.toUpperCase(), interval, candlesJson],
  );
}

export interface EaCandleRow {
  candles_json: string;
  updated_at: string;
}

export async function getEaCandles(
  userId: number,
  symbol: string,
  interval: string,
): Promise<EaCandleRow | null> {
  return queryOne<EaCandleRow>(
    "SELECT candles_json, updated_at FROM ea_market_cache WHERE user_id = ? AND symbol = ? AND interval = ?",
    [userId, symbol.toUpperCase(), interval],
  );
}

/**
 * Like getEaCandles but falls back to a broker-suffix symbol with the same
 * forex canonical key (EURUSD → EURUSDm).
 */
export async function getEaCandlesResolved(
  userId: number,
  symbol: string,
  interval: string,
): Promise<EaCandleRow | null> {
  const exact = await getEaCandles(userId, symbol, interval);
  if (exact) return exact;

  const key = forexCanonicalKey(symbol);
  if (!key) return null;

  const rows = await query<{ symbol: string; candles_json: string; updated_at: string }>(
    "SELECT symbol, candles_json, updated_at FROM ea_market_cache WHERE user_id = ? AND interval = ?",
    [userId, interval],
  );
  return (
    rows.find((r) => forexCanonicalKey(r.symbol) === key) ?? null
  );
}
