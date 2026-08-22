/**
 * News/economic-calendar provider contract. The platform must work WITHOUT a
 * configured provider: in that case news risk is "unknown", never faked. When a
 * provider is wired in, implement this interface and register it below.
 *
 * Two sources are wired today: FMP (API key) and the Forex Factory weekly
 * calendar feed (no key, gated by FOREX_FACTORY_CALENDAR_V1). With both
 * available their events are MERGED: one source failing never hides the
 * other's calendar, and only both failing degrades the agent to unknown.
 */
import { FEATURES } from "@/lib/agent/featureFlags";
import { getCalendarEvents } from "./calendarCache";
import { createFmpProvider } from "./providers/fmpProvider";
import { createForexFactoryProvider } from "./providers/forexFactoryProvider";

export interface EconomicEvent {
  title: string;
  time: string; // ISO 8601
  impact: "low" | "medium" | "high";
  currency?: string;
}

export interface NewsHeadline {
  title: string;
  source: string;
  publishedAt: string;
  url?: string;
}

export interface NewsProvider {
  getEconomicEvents(input: {
    currencies: string[];
    from: Date;
    to: Date;
  }): Promise<EconomicEvent[]>;
  getLiveHeadlines?(input: {
    query: string;
    symbols?: string[];
  }): Promise<NewsHeadline[]>;
}

/** Terms that matter for gold (XAU) beyond plain USD events — Fed policy,
 *  inflation, payrolls, yields. One regex, shared by every calendar source. */
export const GOLD_RELEVANT_TERMS =
  /fed|fomc|cpi|nfp|non[- ]?farm|payroll|inflation|interest rate|yield|treasury|powell|pce/i;

/**
 * The one relevance rule every calendar source applies after mapping: inside
 * the window, and either one of the requested currencies or — when gold is
 * requested — a USD event or a gold-relevant macro title.
 */
export function eventMatchesRequest(
  event: EconomicEvent,
  input: { currencies: string[]; from: Date; to: Date },
): boolean {
  const t = new Date(event.time).getTime();
  if (!(t >= input.from.getTime() && t <= input.to.getTime())) return false;
  const wanted = new Set(input.currencies.map((c) => c.toUpperCase()));
  if (event.currency && wanted.has(event.currency)) return true;
  if (wanted.has("XAU")) {
    if (event.currency === "USD") return true;
    if (GOLD_RELEVANT_TERMS.test(event.title)) return true;
  }
  return false;
}

/** True when any economic-calendar source is available — an API key, or the
 *  keyless Forex Factory feed when its flag is on. */
export function newsProviderConfigured(): boolean {
  return (
    Boolean(
      process.env.FMP_API_KEY ||
        process.env.NEWS_API_KEY ||
        process.env.ECONOMIC_CALENDAR_API_KEY,
    ) || FEATURES.forexFactoryCalendarV1()
  );
}

/** Same event from two sources under slightly different names: dedupe ONLY on
 *  an exact (currency, minute, normalized title) match — over-deduping would
 *  drop real simultaneous releases (CPI m/m and CPI y/y share a timestamp).
 *  Accepted tradeoff (reviewed): two GENUINELY distinct events sharing all
 *  three keys (e.g. two euro-area "Bank Holiday" rows at midnight) collapse to
 *  one — same impact at the same minute, so the risk classification cannot
 *  change; collapsing here is deliberate, not an oversight. */
function dedupeKey(event: EconomicEvent): string {
  const minute = Math.floor(new Date(event.time).getTime() / 60_000);
  const title = event.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return `${event.currency ?? "?"}:${minute}:${title}`;
}

function mergedProvider(providers: NewsProvider[]): NewsProvider {
  return {
    async getEconomicEvents(input) {
      const settled = await Promise.allSettled(
        providers.map((p) => p.getEconomicEvents(input)),
      );
      const fulfilled = settled.filter(
        (s): s is PromiseFulfilledResult<EconomicEvent[]> => s.status === "fulfilled",
      );
      // Every source failing IS a provider failure — the agent must degrade to
      // newsRisk=unknown, not read an empty calendar as a quiet week.
      if (fulfilled.length === 0) {
        const first = settled[0] as PromiseRejectedResult | undefined;
        throw first?.reason instanceof Error
          ? first.reason
          : new Error("All calendar sources failed.");
      }
      const seen = new Set<string>();
      const merged: EconomicEvent[] = [];
      for (const result of fulfilled) {
        for (const event of result.value) {
          const key = dedupeKey(event);
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(event);
        }
      }
      return merged.sort(
        (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
      );
    },
    // Headlines remain FMP's capability; the first provider that offers the
    // optional method serves them.
    async getLiveHeadlines(input) {
      for (const p of providers) {
        if (p.getLiveHeadlines) return p.getLiveHeadlines(input);
      }
      return [];
    },
  };
}

/**
 * The platform-level calendar cache wrapped around whatever source mix is
 * configured. Every consumer of getNewsProvider goes through it: one shared,
 * single-flight fetch per freshness window, event distances computed at read
 * time, and the unchanged fail-closed behavior on a fetch failure with no
 * tolerably-fresh cache (see calendarCache.ts for the full contract).
 */
function withPlatformCalendarCache(inner: NewsProvider): NewsProvider {
  const cached: NewsProvider = {
    getEconomicEvents: (input) =>
      getCalendarEvents(input, { fetch: (span) => inner.getEconomicEvents(span) }),
  };
  if (inner.getLiveHeadlines) {
    cached.getLiveHeadlines = inner.getLiveHeadlines.bind(inner);
  }
  return cached;
}

/**
 * Returns the active provider, or null when none is configured: FMP when a key
 * exists (FMP_API_KEY, with NEWS_API_KEY / ECONOMIC_CALENDAR_API_KEY accepted
 * as aliases), Forex Factory when its flag is on, MERGED when both. If
 * construction fails the agent degrades to newsRisk=unknown — never fake
 * events. Whatever the mix, calendar reads go through the platform cache.
 */
export function getNewsProvider(): NewsProvider | null {
  const providers: NewsProvider[] = [];
  const apiKey =
    process.env.FMP_API_KEY ||
    process.env.NEWS_API_KEY ||
    process.env.ECONOMIC_CALENDAR_API_KEY;
  if (apiKey) {
    try {
      providers.push(createFmpProvider(apiKey));
    } catch {
      /* construction failure → this source is simply absent */
    }
  }
  if (FEATURES.forexFactoryCalendarV1()) {
    try {
      providers.push(createForexFactoryProvider());
    } catch {
      /* construction failure → this source is simply absent */
    }
  }
  if (providers.length === 0) return null;
  return withPlatformCalendarCache(
    providers.length === 1 ? providers[0]! : mergedProvider(providers),
  );
}
