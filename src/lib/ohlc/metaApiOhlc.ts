import { getMtAccount } from "@/lib/store";
import { getMetaApiAccount } from "@/lib/metaapi/client";
import { barDurationMs, normalizeInterval } from "@/lib/intervals";
import type { OhlcCandle } from "@/lib/ohlc/fetchOhlc";

/** Timeframes MetaApi serves as history. */
const METAAPI_INTERVALS = new Set(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]);
/** One page; the picker and the chart both ask for far less than this. */
const MAX_CANDLES = 1000;

interface MetaApiHistoricalCandle {
  time: string | Date;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume?: number;
}

function toOhlc(raw: MetaApiHistoricalCandle[] | null | undefined): OhlcCandle[] {
  return (raw ?? [])
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
}

/**
 * Whether a candle is closed. MetaApi history carries no complete flag (the
 * way a REST feed might), but completeness is pure arithmetic: a bar whose window
 * has fully elapsed is closed; only the newest bar can still be forming.
 */
export function isCandleComplete(
  openTimeMs: number,
  interval: string,
  nowMs = Date.now(),
): boolean {
  return openTimeMs + barDurationMs(normalizeInterval(interval)) <= nowMs;
}

async function getHistoryAccount(userId: number) {
  const account = await getMtAccount(userId);
  if (!account?.metaapi_account_id || account.metaapi_account_id === "mt5local") {
    return { mtAccount: null, warning: "لا يوجد حساب MetaTrader مربوط عبر المنصة." };
  }
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
    return { mtAccount: null, warning: "هذا الحساب لا يوفّر سجل الشموع عبر MetaApi." };
  }
  return { mtAccount, warning: undefined };
}

/**
 * Page size per timeframe. The broker's history cost scales with the TIME SPAN
 * scanned, not the bar count — measured live on the production feeder account
 * (2026-08-07): 1000×15m (10 days) answers in ~0.5s, while 1000×1d (4 years)
 * takes ~19s and 400×1d ~9.6s, both against a 12s page timeout. A full-size
 * daily page therefore timed out on EVERY attempt, warm or cold, which is why
 * the 1d series could never be warmed through this path. Smaller pages keep
 * each request comfortably inside the timeout; the range walker simply takes
 * more of them.
 */
function pageSizeFor(interval: string): number {
  if (interval === "1w") return 100;
  if (interval === "1d") return 250;
  return MAX_CANDLES;
}

async function fetchPage(
  mtAccount: { getHistoricalCandles: (s: string, tf: string, st: Date, l: number) => Promise<MetaApiHistoricalCandle[]> },
  symbol: string,
  interval: string,
  toMs: number,
  limit: number,
): Promise<OhlcCandle[]> {
  /*
   * No client-side timeout: the agent needs to be able to page arbitrarily
   * far back into a broker's real history, and a bar request that takes a
   * while is still a bar request that should finish, not one that gets cut
   * off mid-fetch. The SDK's own retry/error behavior (e.g. failing fast on
   * an unknown symbol) governs how long this can take.
   */
  const raw = (await mtAccount.getHistoricalCandles(
    symbol,
    interval,
    new Date(toMs),
    limit,
  )) as MetaApiHistoricalCandle[];
  return toOhlc(raw);
}

/**
 * Candles straight from the user's cloud MetaTrader account — the ONLY candle
 * pipe. A trader's chart shows THEIR broker's candles, the ones their orders
 * will actually fill against; there is no proxy feed to fall back to, so an
 * unlinked account is reported as exactly that.
 *
 * Older SDK versions expose no history API; that is reported as a warning and
 * the caller surfaces it rather than pretending the series is empty.
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

  try {
    const { mtAccount, warning } = await getHistoryAccount(userId);
    if (!mtAccount) return { candles: [], warning };
    const limit = Math.min(Math.max(opts.limit ?? 300, 10), pageSizeFor(iv));
    const candles = await fetchPage(
      mtAccount,
      symbol,
      iv,
      opts.toMs ?? Date.now(),
      limit,
    );
    return { candles };
  } catch (e) {
    return {
      candles: [],
      warning:
        e instanceof Error ? e.message : "تعذّر جلب الشموع من حساب MetaApi.",
    };
  }
}

/**
 * An inclusive [fromMs, toMs] window, paged backward through the account's
 * full history. MetaApi's history call only anchors on an END time plus a
 * count, so the range is walked newest-first, page after page, until the
 * window's start is covered or the broker itself runs out of history —
 * there is no page cap here, the agent is meant to be able to browse a
 * symbol's entire history, not a bounded slice of it.
 */
export async function fetchMetaApiOhlcRange(
  userId: number,
  symbol: string,
  interval: string,
  opts: { fromMs: number; toMs?: number },
): Promise<{ candles: OhlcCandle[]; reachedStart: boolean; warning?: string }> {
  const iv = normalizeInterval(interval);
  if (!METAAPI_INTERVALS.has(iv)) {
    return {
      candles: [],
      reachedStart: false,
      warning: `الإطار ${iv} غير مدعوم من حساب MetaApi.`,
    };
  }

  try {
    const { mtAccount, warning } = await getHistoryAccount(userId);
    if (!mtAccount) return { candles: [], reachedStart: false, warning };

    const collected = new Map<number, OhlcCandle>();
    let cursor = opts.toMs ?? Date.now();
    let reachedStart = false;

    for (;;) {
      const batch = await fetchPage(mtAccount, symbol, iv, cursor, pageSizeFor(iv));
      if (batch.length === 0) break;
      for (const c of batch) {
        if (c.time >= opts.fromMs && c.time <= cursor) collected.set(c.time, c);
      }
      const earliest = batch[0].time;
      if (earliest <= opts.fromMs) {
        reachedStart = true;
        break;
      }
      // No progress means the broker has nothing older — stop, don't loop.
      if (earliest >= cursor) break;
      cursor = earliest - 1;
    }

    return {
      candles: [...collected.values()].sort((a, b) => a.time - b.time),
      reachedStart,
    };
  } catch (e) {
    return {
      candles: [],
      reachedStart: false,
      warning:
        e instanceof Error ? e.message : "تعذّر جلب الشموع من حساب MetaApi.",
    };
  }
}
