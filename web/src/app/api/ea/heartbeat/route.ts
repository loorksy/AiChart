import { NextRequest, NextResponse } from "next/server";
import { handleError } from "@/lib/api";
import { requireEaConnection } from "@/lib/eaAuth";
import {
  fetchPendingEaCommands,
  recordEaHeartbeat,
  saveEaCandles,
} from "@/lib/eaStore";

interface HeartbeatBody {
  account?: {
    login?: string | number;
    currency?: string;
    balance?: number;
    equity?: number;
    broker?: string;
  };
  symbols?: unknown[];
  candles?: {
    symbol?: string;
    interval?: string;
    bars?: unknown[];
  };
}

/**
 * EA → server heartbeat. The EA posts account state, symbol specs, and
 * (optionally) candles for the active symbol. We return any pending trade
 * commands so the EA can execute them in the same round-trip.
 */
export async function POST(req: NextRequest) {
  try {
    const conn = await requireEaConnection(req);
    const body = (await req.json().catch(() => ({}))) as HeartbeatBody;

    await recordEaHeartbeat(conn.user_id, {
      broker_name: body.account?.broker ?? null,
      account_login:
        body.account?.login != null ? String(body.account.login) : null,
      account_currency: body.account?.currency ?? null,
      balance: Number(body.account?.balance ?? 0) || 0,
      equity: Number(body.account?.equity ?? 0) || 0,
      symbol_specs_json: Array.isArray(body.symbols)
        ? JSON.stringify(body.symbols)
        : null,
    });

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

    const commands = await fetchPendingEaCommands(conn.user_id);
    return NextResponse.json({
      ok: true,
      server_time: new Date().toISOString(),
      commands: commands.map((c) => ({
        id: c.id,
        type: c.command_type,
        payload: JSON.parse(c.payload_json) as unknown,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}
