import type { AnalysisProfile } from "./analysisProfile";
import { cryptoMarketRank } from "./binanceWeb3";

export interface MarketHeadline {
  title: string;
  source: string;
  publishedAt: string;
}

export interface MarketContext {
  headlines: MarketHeadline[];
  fearGreed?: { value: number; label: string };
  socialHype?: string;
  macroNote?: string;
  fetchedAt: string;
}

function baseAsset(symbol: string): string {
  return symbol.toUpperCase().replace(/USDT$/, "");
}

async function fetchFearGreed(): Promise<MarketContext["fearGreed"] | undefined> {
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=1", {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as {
      data?: { value?: string; value_classification?: string }[];
    };
    const row = data.data?.[0];
    if (!row?.value) return undefined;
    return {
      value: Number(row.value),
      label: row.value_classification ?? "Unknown",
    };
  } catch {
    return undefined;
  }
}

async function fetchCryptoPanicHeadlines(
  symbol: string,
  lookbackHours: number,
): Promise<MarketHeadline[]> {
  const apiKey = process.env.CRYPTOPANIC_API_KEY;
  if (!apiKey) return [];

  try {
    const base = baseAsset(symbol);
    const url = new URL("https://cryptopanic.com/api/developer/v2/posts/");
    url.searchParams.set("auth_token", apiKey);
    url.searchParams.set("currencies", base);
    url.searchParams.set("public", "true");
    url.searchParams.set("kind", "news");

    const res = await fetch(url.toString(), { next: { revalidate: 300 } });
    if (!res.ok) return [];

    const data = (await res.json()) as {
      results?: {
        title?: string;
        source?: { title?: string };
        published_at?: string;
      }[];
    };

    const cutoff = Date.now() - lookbackHours * 3600 * 1000;
    return (data.results ?? [])
      .filter((r) => {
        if (!r.published_at) return true;
        return new Date(r.published_at).getTime() >= cutoff;
      })
      .slice(0, 8)
      .map((r) => ({
        title: r.title ?? "",
        source: r.source?.title ?? "CryptoPanic",
        publishedAt: r.published_at ?? new Date().toISOString(),
      }))
      .filter((h) => h.title.length > 0);
  } catch {
    return [];
  }
}

async function fetchSocialHype(symbol: string): Promise<string | undefined> {
  try {
    const base = baseAsset(symbol).toLowerCase();
    const raw = await cryptoMarketRank("social-hype", { chainId: "56" });
    const text = JSON.stringify(raw).slice(0, 8000).toLowerCase();
    if (text.includes(base)) {
      return `رواج اجتماعي مرتفع لـ ${baseAsset(symbol)} على BSC (social-hype)`;
    }
    const parsed = raw as {
      data?: { list?: { symbol?: string; name?: string; score?: number }[] };
    };
    const hit = parsed?.data?.list?.find(
      (t) =>
        t.symbol?.toLowerCase() === base ||
        t.name?.toLowerCase().includes(base),
    );
    if (hit) {
      return `رواج ${baseAsset(symbol)}: score ${hit.score ?? "—"} (social-hype)`;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function fetchMarketContext(
  symbol: string,
  profile: AnalysisProfile,
): Promise<MarketContext> {
  const [headlines, fearGreed, socialHype] = await Promise.all([
    fetchCryptoPanicHeadlines(symbol, profile.newsLookbackHours),
    fetchFearGreed(),
    fetchSocialHype(symbol),
  ]);

  const notes: string[] = [];
  if (fearGreed != null) {
    notes.push(`مؤشر الخوف والطمع: ${fearGreed.value} (${fearGreed.label})`);
  }
  if (socialHype) notes.push(socialHype);

  return {
    headlines,
    fearGreed,
    socialHype,
    macroNote: notes.length > 0 ? notes.join(" · ") : undefined,
    fetchedAt: new Date().toISOString(),
  };
}

export function formatContextForPrompt(ctx: MarketContext): string {
  const parts: string[] = [];
  if (ctx.fearGreed) {
    parts.push(
      `مزاج السوق (Fear&Greed): ${ctx.fearGreed.value} — ${ctx.fearGreed.label}`,
    );
  }
  if (ctx.macroNote) parts.push(ctx.macroNote);
  if (ctx.socialHype) parts.push(ctx.socialHype);
  if (ctx.headlines.length > 0) {
    parts.push("أبرز العناوين:");
    for (const h of ctx.headlines.slice(0, 5)) {
      parts.push(`• [${h.source}] ${h.title}`);
    }
  } else {
    parts.push(
      "لم تُجلب أخبار خارجية — اعتمد على الأدوات والتحليل الفني مع تنبيه المستخدم.",
    );
  }
  return parts.join("\n");
}

export function contextSummary(ctx: MarketContext): string[] {
  const items = ctx.headlines.slice(0, 3).map((h) => h.title);
  if (ctx.fearGreed) {
    items.unshift(`مزاج السوق: ${ctx.fearGreed.value}/100`);
  }
  if (ctx.socialHype) {
    items.unshift(ctx.socialHype);
  }
  return items.slice(0, 4);
}
