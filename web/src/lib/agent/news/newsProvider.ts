/**
 * News/economic-calendar provider contract. The platform must work WITHOUT a
 * configured provider: in that case news risk is "unknown", never faked. When a
 * provider is wired in, implement this interface and register it below.
 */

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

/** True when any economic-calendar/news provider key is configured. */
export function newsProviderConfigured(): boolean {
  return Boolean(
    process.env.NEWS_API_KEY || process.env.ECONOMIC_CALENDAR_API_KEY,
  );
}

/**
 * Returns the active provider, or null when none is configured. Real provider
 * wiring plugs in here; today it returns null (optional-calendar mode) so the
 * agent degrades to newsRisk=unknown instead of inventing events.
 */
export function getNewsProvider(): NewsProvider | null {
  if (!newsProviderConfigured()) return null;
  // TODO(news): construct the concrete provider (e.g. ForexFactory/FMP) from
  // NEWS_API_KEY / ECONOMIC_CALENDAR_API_KEY here. Until wired, treat as
  // unconfigured so no fake news is produced.
  return null;
}
