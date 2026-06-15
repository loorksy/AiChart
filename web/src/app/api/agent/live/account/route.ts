import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth, resolveAgentUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import {
  getEaConnection,
  getEaConnectionMeta,
  isHeartbeatFresh,
  parseEaSymbolSpecs,
} from "@/lib/eaStore";
import {
  getEaLiveQuotes,
  getEaRecentEvents,
  resolveLiveForexMid,
} from "@/lib/eaLiveState";
import {
  ensureBinanceLiveQuotes,
  getBinanceLiveQuotes,
} from "@/lib/binanceLiveState";
import { getBinanceCredentials, listOpenTrades } from "@/lib/store";
import { parseEaPositions } from "@/lib/executionEnv";
import { getFuturesPositions, getFuturesOpenOrders } from "@/lib/binanceFutures";

/** Bridge: unified live account view — MT5 EA quotes + Binance + positions. */
export async function GET(_req: NextRequest) {
  try {
    requireAgentAuth(_req);
    const userId = await resolveAgentUserId();
    const now = Date.now();

    const [conn, eaMeta, openTrades, creds] = await Promise.all([
      getEaConnection(userId),
      getEaConnectionMeta(userId),
      listOpenTrades(userId, 50),
      getBinanceCredentials(userId),
    ]);

    const liveQuotes = getEaLiveQuotes(userId);
    const heartbeatSpecs = parseEaSymbolSpecs(conn?.symbol_specs_json ?? null);
    const mergedForexQuotes: Record<
      string,
      {
        bid: number;
        ask: number;
        quoteAgeMs: number;
        source: "live" | "heartbeat";
      }
    > = {};

    for (const spec of heartbeatSpecs) {
      const sym = spec.symbol?.toUpperCase();
      if (!sym) continue;
      const live = liveQuotes[sym];
      if (live && live.bid > 0 && live.ask > 0) {
        mergedForexQuotes[sym] = {
          bid: live.bid,
          ask: live.ask,
          quoteAgeMs: live.quoteAgeMs,
          source: "live",
        };
      } else {
        const bid = Number(spec.bid) || 0;
        const ask = Number(spec.ask) || 0;
        if (bid > 0 || ask > 0) {
          mergedForexQuotes[sym] = {
            bid,
            ask,
            quoteAgeMs: conn?.last_heartbeat_at
              ? Math.max(
                  0,
                  now -
                    Date.parse(
                      conn.last_heartbeat_at.includes("T")
                        ? conn.last_heartbeat_at
                        : `${conn.last_heartbeat_at.replace(" ", "T")}Z`,
                    ),
                )
              : 60_000,
            source: "heartbeat",
          };
        }
      }
    }

    for (const [sym, q] of Object.entries(liveQuotes)) {
      if (!mergedForexQuotes[sym]) {
        mergedForexQuotes[sym] = {
          bid: q.bid,
          ask: q.ask,
          quoteAgeMs: q.quoteAgeMs,
          source: "live",
        };
      }
    }

    await ensureBinanceLiveQuotes(userId);
    const binanceQuotes = getBinanceLiveQuotes(userId);

    let binanceFutures: unknown = null;
    if (creds) {
      try {
        const [positions, orders] = await Promise.all([
          getFuturesPositions(creds.apiKey, creds.apiSecret, creds.env),
          getFuturesOpenOrders(creds.apiKey, creds.apiSecret, creds.env),
        ]);
        binanceFutures = { positions, pendingOrders: orders, env: creds.env };
      } catch (e) {
        binanceFutures = {
          error: e instanceof Error ? e.message : "تعذّر جلب Binance futures.",
        };
      }
    }

    const mt5Positions = parseEaPositions(conn?.positions_json ?? null);
    const events = getEaRecentEvents(userId, 10);

    const eurusd = resolveLiveForexMid(
      userId,
      "EURUSD",
      heartbeatSpecs.find((s) => s.symbol?.toUpperCase() === "EURUSD")?.bid,
      heartbeatSpecs.find((s) => s.symbol?.toUpperCase() === "EURUSD")?.ask,
    );

    return NextResponse.json({
      ok: true,
      at: new Date().toISOString(),
      forex: {
        ea: eaMeta,
        heartbeatFresh: conn
          ? isHeartbeatFresh(conn.last_heartbeat_at)
          : false,
        liveQuoteCount: Object.keys(liveQuotes).length,
        quotes: mergedForexQuotes,
        positions: mt5Positions,
        recentEvents: events,
        sample: { EURUSD: eurusd },
      },
      binance: {
        connected: Boolean(creds),
        env: creds?.env ?? null,
        liveQuotes: binanceQuotes,
        futures: binanceFutures,
      },
      openTrades,
      hints: {
        staleQuoteThresholdMs: 5000,
        rule: "لا تُنفّذ صفقة إذا quoteAgeMs > 5000 — استدعِ get_live_account أولاً.",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
