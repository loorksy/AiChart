/**
 * The operator's trading mode (docs/UNIFIED_AGENT_PLAN.md §3).
 *
 * Exactly two modes exist once a broker account is connected:
 *
 *  - `advisory`  — the agent analyses, recommends, tracks and notifies, and
 *                  places nothing. The default, and where an operator who has
 *                  never chosen stays.
 *  - `auto`      — the operator has given standing authorisation for the agent
 *                  to execute its own plans when their stated conditions are
 *                  met, without approving each one.
 *
 * Choosing `auto` authorises EXECUTION and nothing else. It does not relax the
 * plan's conditions, the technical safety checks, or the sizing rules — an auto
 * trade goes through exactly the same gates an approved one does. And it is
 * scoped to the connection that was live when it was chosen: if the account
 * drops, the authorisation ends rather than waiting silently for a reconnect
 * the operator may not know about.
 *
 * One state, read by both surfaces. The platform switch and the MCP tool write
 * the same row, so "auto" can never mean one thing in chat and another over
 * MCP.
 */
import { execute, queryOne } from "@/lib/db";
import { getEaConnection, isEaOnlineDebounced } from "@/lib/eaStore";
import { logAudit } from "@/lib/store";
import { createLogger } from "@/lib/logger";
import { FEATURES } from "./featureFlags";

const log = createLogger("trade-mode");

export type TradeMode = "auto" | "advisory";

/** `unset` means a connected operator has not been asked yet. */
export type TradeModeState = "auto" | "advisory" | "unset";

export interface TradeModeView {
  /** What the mode is right now, after connection checks. */
  mode: TradeModeState;
  /** What is stored, before connection checks — for diagnostics and the UI. */
  storedMode: TradeModeState;
  /** Whether a broker connection is live; modes are meaningless without one. */
  connected: boolean;
  /** True when MCP/the UI should ask the operator to choose. */
  needsChoice: boolean;
  /** Set when a stored `auto` was suspended because the connection dropped. */
  /**
   * Why the effective mode is below the stored one.
   *
   * `connection_lost` — the bridge went offline and the standing grant ended.
   * `phase_disabled` — AGENT_TRADE_MODE_V1 is off, so the whole phase is rolled
   * back and everyone is advisory whatever they stored.
   */
  downgradedReason?: "connection_lost" | "phase_disabled";
  updatedAt: number | null;
}

interface ModeRow {
  agent_trade_mode: string | null;
  agent_trade_mode_updated_at: number | null;
  agent_trade_mode_epoch: string | null;
}

/**
 * Identity of the live connection, so an `auto` grant cannot outlive the
 * account it was given for. A reconnect produces a new epoch and the operator
 * is asked again — silence is not consent for the next session.
 */
async function connectionEpoch(userId: number): Promise<string | null> {
  const connection = await getEaConnection(userId).catch(() => null);
  if (!connection) return null;
  if (!isEaOnlineDebounced(userId, connection.last_heartbeat_at ?? null)) return null;
  return `${connection.id}:${connection.account_login ?? "unknown"}`;
}

export async function getTradeMode(userId: number): Promise<TradeModeView> {
  // Gated by AGENT_TRADE_MODE_V1. Off forces advisory for everyone regardless of
  // what they stored — the stored choice is preserved, so turning the phase back
  // on does not lose it.
  if (!FEATURES.agentTradeModeV1()) {
    return {
      mode: "advisory",
      storedMode: "unset",
      connected: false,
      needsChoice: false,
      downgradedReason: "phase_disabled",
      updatedAt: null,
    };
  }

  const row = await queryOne<ModeRow>(
    `SELECT agent_trade_mode, agent_trade_mode_updated_at, agent_trade_mode_epoch
       FROM trading_settings WHERE user_id = ?`,
    [userId],
  ).catch(() => null);

  const stored = (row?.agent_trade_mode as TradeModeState) ?? "unset";
  const updatedAt = row?.agent_trade_mode_updated_at ?? null;
  const epoch = await connectionEpoch(userId);
  const connected = epoch != null;

  if (!connected) {
    // No live account: nothing is executable, so the mode question does not
    // arise and the UI shows analysis only.
    return {
      mode: "advisory",
      storedMode: stored,
      connected: false,
      needsChoice: false,
      downgradedReason: stored === "auto" ? "connection_lost" : undefined,
      updatedAt,
    };
  }

  if (stored === "auto" && row?.agent_trade_mode_epoch !== epoch) {
    // Authorisation was given for a different connection. Treat it as spent.
    return {
      mode: "advisory",
      storedMode: stored,
      connected: true,
      needsChoice: true,
      downgradedReason: "connection_lost",
      updatedAt,
    };
  }

  return {
    mode: stored === "auto" ? "auto" : "advisory",
    storedMode: stored,
    connected: true,
    needsChoice: stored === "unset",
    updatedAt,
  };
}

/** True only when the operator has standing authorisation on THIS connection. */
export async function isAutoExecutionAuthorized(userId: number): Promise<boolean> {
  // Standing authorisation cannot exist while the phase is off.
  if (!FEATURES.agentTradeModeV1()) return false;

  const view = await getTradeMode(userId);
  return view.connected && view.mode === "auto";
}

export interface SetTradeModeResult {
  mode: TradeModeState;
  connected: boolean;
  changed: boolean;
}

/**
 * Record the operator's choice.
 *
 * `auto` is refused without a live connection: standing authorisation for an
 * account we cannot see would be authorisation in name only.
 */
export async function setTradeMode(input: {
  userId: number;
  mode: TradeMode;
  actor: "platform" | "mcp";
}): Promise<SetTradeModeResult> {
  const current = await getTradeMode(input.userId);
  const epoch = await connectionEpoch(input.userId);

  if (input.mode === "auto" && !epoch) {
    throw new Error("لا يمكن تفعيل الوضع التلقائي بدون حساب متصل.");
  }

  const now = Date.now();
  await execute(
    `UPDATE trading_settings
        SET agent_trade_mode = ?, agent_trade_mode_updated_at = ?, agent_trade_mode_epoch = ?
      WHERE user_id = ?`,
    [input.mode, now, input.mode === "auto" ? epoch : null, input.userId],
  );

  const changed = current.storedMode !== input.mode;
  await logAudit(
    input.userId,
    "agent_trade_mode",
    `${current.storedMode} → ${input.mode} (via ${input.actor})`,
  ).catch(() => undefined);
  log.info("trade_mode.set", {
    userId: input.userId,
    from: current.storedMode,
    to: input.mode,
    actor: input.actor,
  });

  return { mode: input.mode, connected: epoch != null, changed };
}

/**
 * Suspend standing authorisation when a connection drops.
 *
 * Called by the EA health monitor. The stored preference is left alone: the
 * operator is asked again on reconnect rather than silently resumed, which is
 * the difference between authorising a session and authorising forever.
 */
export async function suspendAutoOnDisconnect(userId: number): Promise<boolean> {
  const row = await queryOne<ModeRow>(
    "SELECT agent_trade_mode, agent_trade_mode_updated_at, agent_trade_mode_epoch FROM trading_settings WHERE user_id = ?",
    [userId],
  ).catch(() => null);
  if (row?.agent_trade_mode !== "auto") return false;

  await execute(
    `UPDATE trading_settings
        SET agent_trade_mode = 'advisory', agent_trade_mode_updated_at = ?, agent_trade_mode_epoch = NULL
      WHERE user_id = ?`,
    [Date.now(), userId],
  );
  await logAudit(
    userId,
    "agent_trade_mode",
    "auto → advisory (connection lost)",
  ).catch(() => undefined);
  log.info("trade_mode.suspended", { userId, reason: "connection_lost" });
  return true;
}
