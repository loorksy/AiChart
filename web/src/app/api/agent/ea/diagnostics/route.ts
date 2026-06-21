import { NextRequest, NextResponse } from "next/server";
import { spreadFromBidAsk } from "@/lib/spread";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { MT5_RETCODE_LEGEND } from "@/lib/brokers/mt5Retcode";
import {
  getEaConnection,
  getEaOnlineState,
  isHeartbeatFresh,
  parseEaSymbolSpecs,
  toEaConnectionMeta,
} from "@/lib/eaStore";
import { resolveMt5Symbol } from "@/lib/mt5SymbolMap";

/** Bridge: EA connection diagnostics — symbols from heartbeat, quotes, retcode legend. */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const symbolRaw = req.nextUrl.searchParams.get("symbol")?.trim() ?? "";
    const symbolQ = symbolRaw.toUpperCase();

    const conn = await getEaConnection(userId);
    if (!conn) {
      return NextResponse.json({
        online: false,
        status: "revoked",
        symbols: [],
        hasSymbol: false,
        quotesOk: false,
        retcodeLegend: MT5_RETCODE_LEGEND,
        message: "لا يوجد ربط EA — ولّد رمزاً من الإعدادات.",
      });
    }

    const meta = toEaConnectionMeta(conn);
    const onlineState = getEaOnlineState(userId, conn.last_heartbeat_at);
    const specs = parseEaSymbolSpecs(conn.symbol_specs_json);
    const symbols = specs.map((s) => s.symbol).filter(Boolean);

    // P3 — normalise the user-supplied symbol to the broker's actual name
    // (e.g. "EURUSD" → "EURUSDm") using the same helper as get_trade_readiness.
    const resolvedSymbol = symbolQ
      ? ((await resolveMt5Symbol(userId, symbolQ)) ?? symbolQ).toUpperCase()
      : symbolQ;

    const targetSpec = resolvedSymbol
      ? specs.find((s) => s.symbol?.toUpperCase() === resolvedSymbol) ?? null
      : null;
    const hasSymbol = symbolQ ? Boolean(targetSpec) : undefined;
    const bid = Number(targetSpec?.bid) || 0;
    const ask = Number(targetSpec?.ask) || 0;
    const quotesOk = symbolQ ? bid > 0 && ask > 0 : undefined;
    const spread = resolvedSymbol && quotesOk ? spreadFromBidAsk(bid, ask, resolvedSymbol) : null;

    return NextResponse.json({
      online: meta.online,
      status: meta.status,
      platform: meta.platform,
      broker: meta.broker_name,
      account_login: meta.account_login,
      account_currency: meta.account_currency,
      account_trade_mode: meta.account_trade_mode,
      balance: meta.balance,
      equity: meta.equity,
      last_heartbeat_at: meta.last_heartbeat_at,
      heartbeatFresh: isHeartbeatFresh(conn.last_heartbeat_at),
      missedHeartbeats: onlineState.missedHeartbeats,
      settledOnlineSeconds: onlineState.settledOnlineSeconds,
      onlineDebounced: onlineState.online,
      symbols,
      symbolCount: symbols.length,
      ...(symbolRaw
        ? {
            querySymbol: symbolRaw,
            hasSymbol,
            quotesOk,
            spreadPips: spread?.spreadPips ?? null,
            spreadPct: spread?.spreadPct ?? null,
            spec: targetSpec,
          }
        : {}),
      retcodeLegend: MT5_RETCODE_LEGEND,
    });
  } catch (e) {
    return handleError(e);
  }
}
