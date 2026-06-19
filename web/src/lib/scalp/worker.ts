import { fetchOhlc } from "../ohlc/fetchOhlc";
import { barDurationSec } from "../intervals";
import { computeMomentum } from "./momentum";
import {
  DEFAULT_SCALP_THRESHOLDS,
  decideScalpAction,
  type ScalpPosition,
} from "./engine";
import {
  closePositionBySymbol,
  findOpenTradesBySymbol,
  reversePosition,
} from "./positions";
import { createIntent } from "../store";
import {
  getSettings,
  incrementScalpExecuted,
  isMasterKillOn,
  listActiveScalpSessions,
  stopScalpSession,
} from "../store";
import { executeIntent } from "../execution";

/**
 * Global fallback: live execution requires SCALP_LIVE_ENABLED=1 OR the user
 * setting scalp_execution_mode='live'. Per-user mode takes precedence.
 * Kept for backward-compat — prefer per-user scalp_execution_mode.
 */
export function scalpLiveEnabled(): boolean {
  return process.env.SCALP_LIVE_ENABLED === "1";
}

export interface ScalpCycleEvent {
  userId: number;
  symbol: string;
  action: string;
  reason: string;
  executed: boolean;
  paper: boolean;
}

export interface ScalpCycleResult {
  sessions: number;
  events: ScalpCycleEvent[];
  errors: string[];
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[scalp] ${msg}`);
}

/** One pass over all active scalp sessions. Safe to call repeatedly. */
export async function runScalpCycle(
  opts?: { live?: boolean },
): Promise<ScalpCycleResult> {
  // Per-user mode from settings takes precedence over global env flag.
  const globalLive = opts?.live ?? scalpLiveEnabled();
  const result: ScalpCycleResult = { sessions: 0, events: [], errors: [] };

  if (await isMasterKillOn()) {
    result.errors.push("master kill switch — scalp paused");
    return result;
  }

  const sessions = await listActiveScalpSessions();
  result.sessions = sessions.length;

  for (const s of sessions) {
    try {
      const settings = await getSettings(s.user_id);

      // Per-user execution mode: setting takes precedence over global flag.
      const live =
        settings.scalp_execution_mode === "live" ? true : globalLive;

      // Hard stops.
      if (!settings.scalp_enabled) {
        log(`user ${s.user_id} — scalp disabled in settings, stopping session`);
        await stopScalpSession(s.user_id);
        continue;
      }
      if (settings.kill_switch === 1) {
        await stopScalpSession(s.user_id);
        continue;
      }
      const cap = s.max_trades > 0 ? s.max_trades : settings.max_open_trades;
      if (s.executed_count >= cap) {
        await stopScalpSession(s.user_id);
        log(`user ${s.user_id} reached cap ${cap} — session stopped`);
        continue;
      }

      // Market read.
      const ohlc = await fetchOhlc({
        userId: s.user_id,
        symbol: s.symbol,
        interval: s.interval,
        market: s.market,
        limit: 60,
      });
      if (ohlc.candles.length < 5) continue;
      const momentum = computeMomentum(ohlc.candles);
      const price = ohlc.candles[ohlc.candles.length - 1]!.close;

      // Current position (if any).
      const openTrades = await findOpenTradesBySymbol(s.user_id, s.symbol);
      const first = openTrades[0];
      let position: ScalpPosition | null = null;
      if (first) {
        const heldSec =
          (Date.now() - Date.parse(first.created_at)) / 1000;
        position = {
          side: first.side === "sell" ? "sell" : "buy",
          entryPrice: first.avg_price || price,
          barsHeld: Math.max(0, Math.floor(heldSec / barDurationSec(s.interval))),
        };
      }

      const allowShort =
        s.market === "forex" || settings.futures_enabled === 1;
      const decision = decideScalpAction(momentum, position, price, {
        ...DEFAULT_SCALP_THRESHOLDS,
        allowShort,
      });

      const event: ScalpCycleEvent = {
        userId: s.user_id,
        symbol: s.symbol,
        action: decision.action,
        reason: decision.reason,
        executed: false,
        paper: !live,
      };

      if (decision.action === "hold") {
        result.events.push(event);
        continue;
      }

      if (!live) {
        log(
          `PAPER user ${s.user_id} ${s.symbol}: ${decision.action} — ${decision.reason}`,
        );
        result.events.push(event);
        continue;
      }

      // Live — every path below is risk-gated via executeIntent.
      if (decision.action === "close") {
        await closePositionBySymbol(s.user_id, s.symbol);
        event.executed = true;
      } else if (decision.action === "reverse" && decision.side) {
        const r = await reversePosition(s.user_id, {
          symbol: s.symbol,
          newSide: decision.side,
          notional: s.notional,
          market: s.market,
          confidence: decision.confidence,
        });
        event.executed = r.opened?.ok ?? false;
        if (event.executed) await incrementScalpExecuted(s.user_id);
      } else if (
        (decision.action === "buy" || decision.action === "sell") &&
        decision.side
      ) {
        const intent = await createIntent(s.user_id, {
          symbol: s.symbol,
          side: decision.side,
          notional: s.notional,
          market: s.market,
          confidence: decision.confidence,
          status: "approved",
        });
        const exec = await executeIntent(s.user_id, intent.id, {
          explicitApproval: true,
        });
        event.executed = exec.ok;
        if (exec.ok) await incrementScalpExecuted(s.user_id);
      }

      result.events.push(event);
    } catch (e) {
      result.errors.push(
        `user ${s.user_id}: ${e instanceof Error ? e.message : "error"}`,
      );
    }
  }

  return result;
}

/** Continuous loop. Default tick 2s. Stops on SIGINT/SIGTERM. */
export async function runScalpLoop(tickMs = 2000): Promise<void> {
  let running = true;
  const stop = () => {
    running = false;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  log(
    `scalp loop started — tick=${tickMs}ms live=${scalpLiveEnabled() ? "ON" : "PAPER"}`,
  );
  while (running) {
    const started = Date.now();
    try {
      const r = await runScalpCycle();
      if (r.sessions > 0) {
        log(
          `cycle: ${r.sessions} session(s), ${r.events.filter((e) => e.executed).length} executed, ${r.errors.length} error(s)`,
        );
      }
    } catch (e) {
      log(`cycle error: ${e instanceof Error ? e.message : "unknown"}`);
    }
    const elapsed = Date.now() - started;
    await new Promise((res) => setTimeout(res, Math.max(0, tickMs - elapsed)));
  }
  log("scalp loop stopped");
}
