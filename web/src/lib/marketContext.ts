import type { AnalysisProfile } from "./analysisProfile";
import type { MarketSnapshot } from "./market";

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

export async function fetchMarketContext(
  _symbol: string,
  _profile: AnalysisProfile,
): Promise<MarketContext> {
  const [fearGreed] = await Promise.all([fetchFearGreed()]);

  const notes: string[] = [];
  if (fearGreed != null) {
    notes.push(`مؤشر الخوف والطمع: ${fearGreed.value} (${fearGreed.label})`);
  }

  return {
    headlines: [],
    fearGreed,
    socialHype: undefined,
    macroNote: notes.length > 0 ? notes.join(" · ") : undefined,
    fetchedAt: new Date().toISOString(),
  };
}

export function formatContextForPrompt(ctx: MarketContext): string {
  const parts: string[] = [];
  if (ctx.fearGreed) {
    parts.push(
      `مؤشر الخوف والطمع (عام — للسوق ككل): ${ctx.fearGreed.value} — ${ctx.fearGreed.label}`,
    );
  }
  if (ctx.macroNote) parts.push(ctx.macroNote);
  parts.push(
    "لا تُجلب أخبار خارجية تلقائياً — اعتمد على الأدوات والتحليل الفني مع تنبيه المستخدم عند الحاجة.",
  );
  return parts.join("\n");
}

export function snapshotSummaryLines(snap: MarketSnapshot): string[] {
  const trend =
    snap.trend === "uptrend"
      ? "صاعد"
      : snap.trend === "downtrend"
        ? "هابط"
        : "عرضي";
  const lines = [
    `${snap.symbol} · ${snap.interval}`,
    `اتجاه: ${trend}`,
  ];
  if (snap.rsi14 != null) {
    lines.push(`RSI(14): ${snap.rsi14.toFixed(1)}`);
  }
  lines.push(
    `تغيّر 24س: ${snap.change24hPct >= 0 ? "+" : ""}${snap.change24hPct.toFixed(2)}%`,
  );
  return lines;
}

export function contextSummary(ctx: MarketContext): string[] {
  const items: string[] = [];
  if (ctx.fearGreed) {
    items.unshift(
      `مؤشر الخوف والطمع (عام): ${ctx.fearGreed.value}/100`,
    );
  }
  return items.slice(0, 4);
}
