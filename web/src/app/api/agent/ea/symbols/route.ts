import { withBridge } from "@/lib/bridge";
import { getEaConnection, parseEaSymbolSpecs } from "@/lib/eaStore";
import { isHeartbeatFresh } from "@/lib/eaStore";
import { spreadFromBidAsk } from "@/lib/spread";

/**
 * Bridge: the FULL list of symbols the broker exposes in the account's MetaTrader
 * Market Watch (from the EA heartbeat specs) — not just the user's watchlist.
 * Lets the agent "see the account" and switch between any tradable pair.
 */
export const GET = withBridge(async ({ req, userId }) => {
  const q = req.nextUrl.searchParams.get("q")?.trim().toUpperCase();
  const marketFilter = req.nextUrl.searchParams.get("market");
  const limit = Math.min(
    Number(req.nextUrl.searchParams.get("limit")) || 300,
    500,
  );

  const conn = await getEaConnection(userId);
  if (!conn) {
    return {
      connected: false,
      heartbeatFresh: false,
      count: 0,
      symbols: [],
      note_ar: "لا يوجد ربط MetaTrader EA — اربط الحساب من الإعدادات.",
    };
  }

  const heartbeatFresh = isHeartbeatFresh(conn.last_heartbeat_at);
  const specs = parseEaSymbolSpecs(conn.symbol_specs_json);

  let rows = specs
    .filter((s) => s.symbol)
    .map((s) => {
      const bid = Number(s.bid) || 0;
      const ask = Number(s.ask) || 0;
      const sp = bid > 0 && ask > 0 ? spreadFromBidAsk(bid, ask, s.symbol) : null;
      const market = "forex" as const;
      return {
        symbol: s.symbol,
        market,
        bid: bid || null,
        ask: ask || null,
        digits: s.digits ?? null,
        spreadPrice: sp ? Math.round(sp.spreadRaw * 1e6) / 1e6 : null,
        spreadPct: sp ? Math.round(sp.spreadPct * 1000) / 1000 : null,
        spreadPips: sp ? Math.round(sp.spreadPips * 10) / 10 : null,
        tradable: bid > 0 && ask > 0,
      };
    });

  if (marketFilter === "forex") {
    rows = rows.filter((r) => r.market === marketFilter);
  }
  if (q) {
    rows = rows.filter((r) => r.symbol.toUpperCase().includes(q));
  }
  rows.sort((a, b) => a.symbol.localeCompare(b.symbol));

  return {
    connected: true,
    heartbeatFresh,
    count: rows.length,
    symbols: rows.slice(0, limit),
    note_ar: heartbeatFresh
      ? undefined
      : "نبض EA غير حديث — الأسعار قد تكون قديمة.",
  };
}, { routeKey: "/api/agent/ea/symbols" });
