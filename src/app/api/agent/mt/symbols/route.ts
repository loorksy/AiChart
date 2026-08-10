import { withBridge } from "@/lib/bridge";
import { getMtAccount, resolveForexBackendForUser } from "@/lib/store";
import { getRpcConnection } from "@/lib/metaapi/client";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { TRADABLE_SYMBOLS } from "@/lib/markets/forexInstruments";

const TRADABLE_SET = new Set(TRADABLE_SYMBOLS.map((s) => forexCanonicalKey(s)));

/**
 * Bridge: the broker's Market Watch symbols for the linked account, narrowed
 * to the platform's fixed 20-instrument universe — not the user's watchlist,
 * but also not literally everything the broker lists. The agent only
 * analyses and trades this fixed set (see markets/forexInstruments.ts), so
 * an execution/account-visibility tool offering symbols outside it would
 * let a proposal reference an instrument nothing ever analysed.
 *
 * A MetaApi account is asked over RPC; the self-hosted bridge exposes no
 * listing at all. Answering "no MetaTrader link" for a connected cloud
 * account — which is what this route used to do — makes the agent tell the
 * operator their account is not linked.
 */
export const GET = withBridge(async ({ req, userId }) => {
  const q = req.nextUrl.searchParams.get("q")?.trim().toUpperCase();
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
      const all = (await conn.getSymbols()).filter((s) =>
        TRADABLE_SET.has(forexCanonicalKey(s)),
      );
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
}, { routeKey: "/api/agent/mt/symbols" });
