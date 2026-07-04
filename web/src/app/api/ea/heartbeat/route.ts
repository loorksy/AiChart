import { NextRequest, NextResponse } from "next/server";
import { handleError } from "@/lib/api";
import { requireEaConnection } from "@/lib/eaAuth";
import {
  recordEaHeartbeat,
  saveEaCandles,
} from "@/lib/eaStore";
import { reconcileEaPositions } from "@/lib/eaPositionSync";
import { eaKillCloseFlagKey, eaReconnectFlagKey, eaResyncCandlesFlagKey } from "@/lib/eaTradeCommands";
import { parseEaPositions } from "@/lib/executionEnv";
import { getFlag, getSettings, setFlag } from "@/lib/store";

interface HeartbeatBody {
  account?: {
    login?: string | number;
    currency?: string;
    balance?: number;
    equity?: number;
    broker?: string;
    trade_mode?: string;
  };
  positions?: unknown[];
  symbols?: unknown[];
  candles?: {
    symbol?: string;
    interval?: string;
    bars?: unknown[];
  };
}

/**
 * EA → server heartbeat. Posts account state; v2 EA polls commands via GET.
 */
export async function POST(req: NextRequest) {
  try {
    const conn = await requireEaConnection(req);
    const body = (await req.json().catch(() => ({}))) as HeartbeatBody;

    const previousPositions = parseEaPositions(conn.positions_json ?? null);
    const incomingPositions = Array.isArray(body.positions)
      ? parseEaPositions(JSON.stringify(body.positions))
      : [];

    await recordEaHeartbeat(conn.user_id, {
      broker_name: body.account?.broker ?? null,
      account_login:
        body.account?.login != null ? String(body.account.login) : null,
      account_currency: body.account?.currency ?? null,
      account_trade_mode: body.account?.trade_mode ?? null,
      // Partial heartbeats (candles/positions-only) must NOT zero the stored
      // account: pass null so the store keeps the last known real value.
      balance:
        body.account?.balance != null &&
        Number.isFinite(Number(body.account.balance))
          ? Number(body.account.balance)
          : null,
      equity:
        body.account?.equity != null &&
        Number.isFinite(Number(body.account.equity))
          ? Number(body.account.equity)
          : null,
      symbol_specs_json: Array.isArray(body.symbols)
        ? JSON.stringify(body.symbols)
        : null,
      positions_json: Array.isArray(body.positions)
        ? JSON.stringify(body.positions)
        : null,
    });

    if (incomingPositions.length > 0 || previousPositions.length > 0) {
      await reconcileEaPositions(
        conn.user_id,
        incomingPositions,
        previousPositions,
      );
    }

    if (
      body.candles?.symbol &&
      body.candles.interval &&
      Array.isArray(body.candles.bars)
    ) {
      await saveEaCandles(
        conn.user_id,
        String(body.candles.symbol),
        String(body.candles.interval),
        JSON.stringify(body.candles.bars),
      );
    }

    const settings = await getSettings(conn.user_id);
    const killCloseKey = eaKillCloseFlagKey(conn.user_id);
    const closeOpenPending = (await getFlag(killCloseKey)) === "1";
    if (closeOpenPending) {
      await setFlag(killCloseKey, "0");
    }

    const reconnectKey = eaReconnectFlagKey(conn.user_id);
    const resyncKey = eaResyncCandlesFlagKey(conn.user_id);
    const reconnectPending = (await getFlag(reconnectKey)) === "1";
    const resyncPending = (await getFlag(resyncKey)) === "1";
    if (reconnectPending) {
      await setFlag(reconnectKey, "0");
    }
    if (resyncPending) {
      await setFlag(resyncKey, "0");
    }

    return NextResponse.json({
      ok: true,
      server_time: new Date().toISOString(),
      flags: {
        close_open_trades: closeOpenPending,
        ...(reconnectPending ? { reconnect: true } : {}),
        ...(resyncPending ? { resync_candles: true } : {}),
      },
      commands: [],
    });
  } catch (err) {
    return handleError(err);
  }
}
