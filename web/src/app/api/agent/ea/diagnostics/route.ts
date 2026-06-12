import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth, resolveAgentUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { MT5_RETCODE_LEGEND } from "@/lib/brokers/mt5Retcode";
import {
  getEaConnection,
  isHeartbeatFresh,
  parseEaSymbolSpecs,
  toEaConnectionMeta,
} from "@/lib/eaStore";

/** Bridge: EA connection diagnostics — symbols from heartbeat, quotes, retcode legend. */
export async function GET(req: NextRequest) {
  try {
    requireAgentAuth(req);
    const userId = await resolveAgentUserId();
    const symbolQ = req.nextUrl.searchParams.get("symbol")?.toUpperCase().trim() ?? "";

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
    const specs = parseEaSymbolSpecs(conn.symbol_specs_json);
    const symbols = specs.map((s) => s.symbol).filter(Boolean);

    const targetSpec = symbolQ
      ? specs.find((s) => s.symbol?.toUpperCase() === symbolQ) ?? null
      : null;
    const hasSymbol = symbolQ ? Boolean(targetSpec) : undefined;
    const bid = Number(targetSpec?.bid) || 0;
    const ask = Number(targetSpec?.ask) || 0;
    const quotesOk = symbolQ ? bid > 0 && ask > 0 : undefined;

    return NextResponse.json({
      online: meta.online,
      status: meta.status,
      platform: meta.platform,
      broker: meta.broker_name,
      account_login: meta.account_login,
      account_currency: meta.account_currency,
      balance: meta.balance,
      equity: meta.equity,
      last_heartbeat_at: meta.last_heartbeat_at,
      heartbeatFresh: isHeartbeatFresh(conn.last_heartbeat_at),
      symbols,
      symbolCount: symbols.length,
      ...(symbolQ
        ? {
            querySymbol: symbolQ,
            hasSymbol,
            quotesOk,
            spec: targetSpec,
          }
        : {}),
      retcodeLegend: MT5_RETCODE_LEGEND,
    });
  } catch (e) {
    return handleError(e);
  }
}
