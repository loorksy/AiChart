/**
 * News/economic-calendar provider contract. The platform must work WITHOUT a
 * configured provider: in that case news risk is "unknown", never faked. When a
 * provider is wired in, implement this interface and register it below.
 */
import { createFmpProvider } from "./providers/fmpProvider";

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
    process.env.FMP_API_KEY ||
      process.env.NEWS_API_KEY ||
      process.env.ECONOMIC_CALENDAR_API_KEY,
  );
}

/**
 * Returns the active provider, or null when none is configured. FMP is the
 * wired implementation (FMP_API_KEY, with NEWS_API_KEY /
 * ECONOMIC_CALENDAR_API_KEY accepted as aliases). If construction fails the
 * agent degrades to newsRisk=unknown — never fake events.
 */
export function getNewsProvider(): NewsProvider | null {
  const apiKey =
    process.env.FMP_API_KEY ||
    process.env.NEWS_API_KEY ||
    process.env.ECONOMIC_CALENDAR_API_KEY;
  if (!apiKey) return null;
  try {
    return createFmpProvider(apiKey);
  } catch {
    // Provider construction failed → honest unknown, never fake events.
    return null;
  }
}
