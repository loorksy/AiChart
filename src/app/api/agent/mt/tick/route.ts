import { withBridge } from "@/lib/bridge";
import { ApiError } from "@/lib/api";
import { fetchOandaPricing, oandaConfigured } from "@/lib/markets/oanda";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { TRADABLE_SYMBOLS } from "@/lib/markets/forexInstruments";

const TRADABLE_SET = new Set(TRADABLE_SYMBOLS.map((s) => forexCanonicalKey(s)));

/** Bridge: the most recent tick for a symbol, from the platform's OANDA feed. */
export const GET = withBridge(async ({ req }) => {
  const symbolRaw = req.nextUrl.searchParams.get("symbol")?.trim();
  if (!symbolRaw) throw new ApiError(400, "symbol مطلوب.");
  const symbol = forexCanonicalKey(symbolRaw) || symbolRaw.toUpperCase();
  if (!TRADABLE_SET.has(symbol)) {
    throw new ApiError(400, `الرمز "${symbolRaw}" خارج نطاق الأدوات المتاحة (20 أداة ثابتة).`);
  }
  if (!oandaConfigured()) {
    throw new ApiError(503, "مزوّد بيانات OANDA غير مهيّأ على المنصة.");
  }
  const [q] = await fetchOandaPricing([symbol]);
  if (!q || q.bid == null || q.ask == null) {
    throw new ApiError(502, "تعذّر جلب آخر سعر من OANDA.");
  }
  return {
    symbol,
    tick: {
      bid: q.bid,
      ask: q.ask,
      time: new Date().toISOString(),
    },
  };
}, { routeKey: "/api/agent/mt/tick" });
