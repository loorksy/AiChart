import { createLogger } from "@/lib/logger";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { normalizeCanonicalInterval } from "@/lib/markets/intervals";

const log = createLogger("candles.warmDemand");

/**
 * Which (symbol, interval) series the platform has actually been asked for.
 *
 * The warehouse used to be warmed from a hand-maintained CANDLE_SYNC_SYMBOLS
 * list filtered through a 17-entry registry, while analysis itself is open to
 * every symbol the linked broker offers — 356 of them in production. Any pair
 * outside that list therefore found an empty warehouse and paid a live broker
 * history pull inside the request, against a 10s stage deadline it could not
 * meet. Widening the list is not the answer either: warming all 356 across five
 * intervals is roughly 80 GB against 19 GB free.
 *
 * So demand is recorded where it happens — the moment a request finds coverage
 * too thin — and the cron warms what was actually asked for. A pair goes slow
 * once, then joins the rotation.
 *
 * This rides the existing flag store rather than a new table: it is a small
 * bounded list, it must survive a restart, and it is not worth a migration.
 */
const DEMAND_FLAG = "candle_warm_demand";

/** Beyond this the tail is old enough that nobody is watching those pairs. */
const MAX_ENTRIES = 60;

/** A series nobody has asked for in this long stops being warmed. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export interface WarmDemandEntry {
  symbol: string;
  interval: string;
  /** Epoch ms of the most recent request for this series. */
  at: number;
}

/**
 * Loaded on use, not at module load. `@/lib/store` pulls in the whole
 * persistence stack; keeping it out of the import graph lets the pure
 * normalization above be exercised on its own.
 */
async function flagStore() {
  return import("@/lib/store");
}

function parse(raw: unknown): WarmDemandEntry[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const { symbol, interval, at } = item as Record<string, unknown>;
      if (typeof symbol !== "string" || typeof interval !== "string") return [];
      if (typeof at !== "number" || !Number.isFinite(at)) return [];
      return [{ symbol, interval, at }];
    });
  } catch {
    return [];
  }
}

function key(entry: { symbol: string; interval: string }): string {
  return `${entry.symbol}|${entry.interval}`;
}

/**
 * Newest first, de-duplicated, expired entries dropped, capped. Exported so the
 * cron and the tests agree on the shape without either re-deriving it.
 */
export function normalizeDemand(
  entries: WarmDemandEntry[],
  now: number,
): WarmDemandEntry[] {
  const newestPerSeries = new Map<string, WarmDemandEntry>();
  for (const entry of entries) {
    if (now - entry.at > MAX_AGE_MS) continue;
    const existing = newestPerSeries.get(key(entry));
    if (!existing || entry.at > existing.at) newestPerSeries.set(key(entry), entry);
  }
  return [...newestPerSeries.values()]
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_ENTRIES);
}

/**
 * Note that this series was wanted. Never throws and never blocks anything the
 * operator is waiting on — a lost demand record costs one more slow first
 * analysis, so it must not be able to cost the analysis itself.
 */
export async function recordWarmDemand(input: {
  symbol: string;
  interval: string;
  now?: number;
}): Promise<void> {
  try {
    const symbol = forexCanonicalKey(input.symbol);
    const interval = normalizeCanonicalInterval(input.interval);
    if (!symbol || !interval) return;
    const now = input.now ?? Date.now();
    const { getFlag, setFlag } = await flagStore();
    const current = parse(await getFlag(DEMAND_FLAG));
    const next = normalizeDemand([{ symbol, interval, at: now }, ...current], now);
    await setFlag(DEMAND_FLAG, JSON.stringify(next));
  } catch (error) {
    log.warn("could not record warm demand", {
      symbol: input.symbol,
      interval: input.interval,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** The series worth warming, newest demand first. */
export async function listWarmDemand(now = Date.now()): Promise<WarmDemandEntry[]> {
  try {
    const { getFlag } = await flagStore();
    return normalizeDemand(parse(await getFlag(DEMAND_FLAG)), now);
  } catch (error) {
    log.warn("could not read warm demand", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
