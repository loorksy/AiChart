import type { Metadata } from "next";
import { EmbedLiveChart } from "@/components/chart/EmbedLiveChart";
import { coerceToGold } from "@/lib/gold";
import { isAppLocale } from "@/lib/i18n";
import { normalizeInterval } from "@/lib/intervals";

export const metadata: Metadata = {
  title: "Live gold chart",
  robots: { index: false, follow: false },
};

function pick(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

export default async function EmbedChartPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const localeRaw = pick(params, "locale") ?? "ar";
  return (
    <EmbedLiveChart
      symbol={coerceToGold(pick(params, "symbol"))}
      interval={normalizeInterval(pick(params, "interval") || "15m")}
      theme={pick(params, "theme") === "light" ? "light" : "dark"}
      locale={isAppLocale(localeRaw) ? localeRaw : "ar"}
    />
  );
}
