import type { Metadata } from "next";
import { EmbedLiveChart } from "@/components/chart/EmbedLiveChart";
import type { ChartStudy } from "@/lib/chart/studies";
import type { ChartDrawing } from "@/lib/chartDrawings";
import { verifyChartEmbedToken } from "@/lib/embedChartToken";
import { coerceToGold } from "@/lib/gold";
import { isAppLocale } from "@/lib/i18n";
import { normalizeInterval } from "@/lib/intervals";
import { getChartLayoutById, getOrCreateChartLayout } from "@/lib/store";
import type { Recommendation } from "@/lib/types";

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

function parseLayoutState(raw: string | null): {
  drawings: ChartDrawing[];
  studies: ChartStudy[];
  recommendation: Recommendation | null;
  targets: number[];
  drawingsCleared: boolean;
} {
  if (!raw) {
    return {
      drawings: [],
      studies: [],
      recommendation: null,
      targets: [],
      drawingsCleared: false,
    };
  }
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== "object") {
      return {
        drawings: [],
        studies: [],
        recommendation: null,
        targets: [],
        drawingsCleared: false,
      };
    }
    return {
      drawings: Array.isArray(v.drawings) ? (v.drawings as ChartDrawing[]) : [],
      studies: Array.isArray(v.studies) ? (v.studies as ChartStudy[]) : [],
      recommendation:
        v.recommendation === null || (v.recommendation && typeof v.recommendation === "object")
          ? ((v.recommendation ?? null) as Recommendation | null)
          : null,
      targets: Array.isArray(v.targets)
        ? v.targets.filter((n): n is number => typeof n === "number")
        : [],
      drawingsCleared: v.drawingsCleared === true,
    };
  } catch {
    return {
      drawings: [],
      studies: [],
      recommendation: null,
      targets: [],
      drawingsCleared: false,
    };
  }
}

export default async function EmbedChartPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const localeRaw = pick(params, "locale") ?? "ar";
  const locale = isAppLocale(localeRaw) ? localeRaw : "ar";
  const theme = pick(params, "theme") === "light" ? "light" : "dark";
  const token = pick(params, "token");
  const claims = token ? verifyChartEmbedToken(token) : null;

  if (token && !claims) {
    return (
      <EmbedLiveChart
        symbol={coerceToGold()}
        interval="15m"
        theme={theme}
        locale={locale}
        invalidToken
      />
    );
  }

  let symbol = coerceToGold(pick(params, "symbol"));
  let interval = normalizeInterval(pick(params, "interval") || "15m");
  let drawings: ChartDrawing[] = [];
  let studies: ChartStudy[] = [];
  let recommendation: Recommendation | null = null;
  let targets: number[] = [];
  let drawingsCleared = false;

  if (claims) {
    symbol = coerceToGold(claims.symbol);
    interval = normalizeInterval(claims.interval);
    const layout = claims.layoutId
      ? (await getChartLayoutById(claims.layoutId, claims.userId)) ??
        (await getOrCreateChartLayout(claims.userId, claims.symbol))
      : await getOrCreateChartLayout(claims.userId, claims.symbol);
    symbol = coerceToGold(layout.symbol || claims.symbol);
    interval = normalizeInterval(layout.interval || claims.interval);
    const visuals = parseLayoutState(layout.state_json);
    drawings = visuals.drawings;
    studies = visuals.studies;
    recommendation = visuals.recommendation;
    targets = visuals.targets;
    drawingsCleared = visuals.drawingsCleared;
  }

  return (
    <EmbedLiveChart
      symbol={symbol}
      interval={interval}
      theme={theme}
      locale={locale}
      drawings={drawings}
      studies={studies}
      recommendation={recommendation}
      targets={targets}
      paintTradeOverlay={!drawingsCleared}
    />
  );
}
