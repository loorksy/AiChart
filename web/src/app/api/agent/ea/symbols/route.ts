import { withBridge } from "@/lib/bridge";
import { getEaConnection, parseEaSymbolSpecs } from "@/lib/eaStore";
import { isHeartbeatFresh } from "@/lib/eaStore";
import { spreadFromBidAsk } from "@/lib/spread";
import { getMtAccount, resolveForexBackendForUser } from "@/lib/store";
import { getRpcConnection } from "@/lib/metaapi/client";

/**
 * Bridge: the FULL list of symbols the broker exposes in the account's MetaTrader
 * Market Watch (from the EA heartbeat specs) — not just the user's watchlist.
 * Lets the agent "see the account" and switch between any tradable pair.
 *
 * The account may be connected through any of three backends. Only the EA one
 * publishes symbol specs through the heartbeat; a MetaApi account is asked over
 * RPC instead, and the self-hosted bridge exposes no listing at all. Answering
 * "no MetaTrader link" for a connected cloud account — which is what this route
 * used to do — makes the agent tell the operator their account is not linked.
 */
export const GET = withBridge(async ({ req, userId }) => {
  const q = req.nextUrl.searchParams.get("q")?.trim().toUpperCase();
  const marketFilter = req.nextUrl.searchParams.get("market");
  const limit = Math.min(
    Number(req.nextUrl.searchParams.get("limit")) || 300,
    500,
  );

  const backend = await resolveForexBackendForUser(userId);

  if (backend === "metaapi") {
    const account = await getMtAccount(userId);
    if (!account?.metaapi_account_id || account.metaapi_account_id === "mt5local") {
      return {
        backend,
        connected: false,
        heartbeatFresh: false,
        count: 0,
        symbols: [],
        note_ar: "لا يوجد حساب MetaTrader مربوط عبر المنصة — اربطه من الإعدادات.",
      };
    }
    try {
      const conn = await getRpcConnection(userId, account.metaapi_account_id);
      const all = await conn.getSymbols();
      const filtered = (q ? all.filter((s) => s.toUpperCase().includes(q)) : all)
        .slice()
        .sort((a, b) => a.localeCompare(b));
      return {
        backend,
        connected: true,
        heartbeatFresh: true,
        count: filtered.length,
        symbols: filtered.slice(0, limit).map((symbol) => ({
          symbol,
          market: "forex" as const,
          // MetaApi quotes one symbol at a time; a list request does not carry
          // prices, and inventing nulls-as-zero would read as a dead market.
          bid: null,
          ask: null,
          digits: null,
          spreadPrice: null,
          spreadPct: null,
          spreadPips: null,
          tradable: true,
        })),
        note_ar:
          "قائمة رموز الحساب عبر MetaApi — استخدم get_market_price للسعر اللحظي لرمز محدد.",
      };
    } catch (e) {
      return {
        backend,
        connected: true,
        heartbeatFresh: false,
        count: 0,
        symbols: [],
        note_ar: `تعذّر جلب رموز الحساب من MetaApi: ${
          e instanceof Error ? e.message : "خطأ غير معروف"
        }`,
      };
    }
  }

  if (backend === "mt5local") {
    const account = await getMtAccount(userId);
    return {
      backend,
      connected: Boolean(account),
      heartbeatFresh: false,
      count: 0,
      symbols: [],
      note_ar: account
        ? "حساب مربوط عبر جسر MT5 المستضاف — لا يوفّر قائمة رموز؛ استخدم get_market_price لرمز محدد."
        : "لا يوجد حساب MetaTrader مربوط — اربطه من الإعدادات.",
    };
  }

  const conn = await getEaConnection(userId);
  if (!conn) {
    return {
      backend,
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
    backend,
    connected: true,
    heartbeatFresh,
    count: rows.length,
    symbols: rows.slice(0, limit),
    note_ar: heartbeatFresh
      ? undefined
      : "نبض EA غير حديث — الأسعار قد تكون قديمة.",
  };
}, { routeKey: "/api/agent/ea/symbols" });
