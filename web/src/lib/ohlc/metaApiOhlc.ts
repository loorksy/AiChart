import { getMtAccount } from "@/lib/store";
import { getMetaApiAccount } from "@/lib/metaapi/client";
import { normalizeInterval } from "@/lib/intervals";
import type { OhlcCandle } from "@/lib/ohlc/fetchOhlc";

/** Timeframes MetaApi serves as history. */
const METAAPI_INTERVALS = new Set(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]);
/** One page; the picker and the chart both ask for far less than this. */
const MAX_CANDLES = 1000;
/** Longer than a healthy broker round-trip, far shorter than the SDK's retries. */
const HISTORY_TIMEOUT_MS = 12_000;

interface MetaApiHistoricalCandle {
  time: string | Date;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume?: number;
}

/**
 * Candles straight from the user's cloud MetaTrader account.
 *
 * The second pipe, beside the platform's OANDA feed: a MetaApi-linked account
 * has its own broker history, and a trader who links a cloud account expects
 * the chart to show THAT broker's candles — the ones their orders will
 * actually fill against — not a proxy feed.
 *
 * Older SDK versions expose no history API; that is reported as a warning and
 * the caller falls back rather than pretending the series is empty.
 */
export async function fetchMetaApiOhlc(
  userId: number,
  symbol: string,
  interval: string,
  opts: { toMs?: number; limit?: number } = {},
): Promise<{ candles: OhlcCandle[]; warning?: string }> {
  const iv = normalizeInterval(interval);
  if (!METAAPI_INTERVALS.has(iv)) {
    return { candles: [], warning: `الإطار ${iv} غير مدعوم من حساب MetaApi.` };
  }

  const account = await getMtAccount(userId);
  if (!account?.metaapi_account_id || account.metaapi_account_id === "mt5local") {
    return { candles: [], warning: "لا يوجد حساب MetaTrader مربوط عبر المنصة." };
  }

  try {
    /*
     * The ACCOUNT, not the RPC connection.
     *
     * getHistoricalCandles is declared on MetatraderAccount
     * (dist/metaApi/metatraderAccount.d.ts). Asking the connection for it
     * returned undefined, and this function reported "هذا الحساب لا يوفّر سجل
     * الشموع" — for an account that serves it perfectly well. That single wrong
     * object is why a linked cloud account produced an empty chart, empty pair
     * cards, and a silent fall back to the platform feed.
     */
    const mtAccount = await getMetaApiAccount(userId, account.metaapi_account_id);
    if (typeof mtAccount.getHistoricalCandles !== "function") {
      return { candles: [], warning: "هذا الحساب لا يوفّر سجل الشموع عبر MetaApi." };
    }

    const limit = Math.min(Math.max(opts.limit ?? 300, 10), MAX_CANDLES);
    /*
     * Bounded. The SDK retries an unknown symbol for over a minute — a wrong
     * spelling once cost 75s before answering "Symbol XAUUSDM does not exist",
     * and the chart has no business hanging that long on a bar request.
     */
    const raw = (await Promise.race([
      mtAccount.getHistoricalCandles(
        symbol,
        iv,
        new Date(opts.toMs ?? Date.now()),
        limit,
      ),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("مهلة جلب الشموع من حساب MetaApi انتهت.")),
          HISTORY_TIMEOUT_MS,
        ),
      ),
    ])) as MetaApiHistoricalCandle[];

    const candles: OhlcCandle[] = (raw ?? [])
      .map((c) => ({
        time: new Date(c.time).getTime(),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.tickVolume ?? 0),
      }))
      .filter((c) => Number.isFinite(c.time) && c.time > 0 && Number.isFinite(c.close))
      .sort((a, b) => a.time - b.time);

    return { candles };
  } catch (e) {
    return {
      candles: [],
      warning:
        e instanceof Error ? e.message : "تعذّر جلب الشموع من حساب MetaApi.",
    };
  }
}
