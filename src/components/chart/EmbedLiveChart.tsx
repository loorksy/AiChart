"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { ChartStudy } from "@/lib/chart/studies";
import type { ChartDrawing } from "@/lib/chartDrawings";
import { coerceToGold } from "@/lib/gold";
import { dirForLocale, type AppLocale } from "@/lib/i18n";
import { normalizeInterval } from "@/lib/intervals";
import type { Recommendation } from "@/lib/types";

const TvChart = dynamic(() => import("@/components/chart/TvChart"), {
  ssr: false,
});

const MSG_TYPE = "aichart:live-chart";

type LiveChartMessage = {
  type?: string;
  symbol?: string;
  interval?: string;
  theme?: "light" | "dark";
  drawings?: ChartDrawing[];
  recommendation?: Recommendation | null;
  targets?: number[];
  studies?: ChartStudy[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object";
}

export function EmbedLiveChart(props: {
  symbol: string;
  interval: string;
  theme: "light" | "dark";
  locale: AppLocale;
}) {
  const [symbol, setSymbol] = useState(props.symbol);
  const [interval, setInterval] = useState(props.interval);
  const [theme, setTheme] = useState(props.theme);
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [targets, setTargets] = useState<number[]>([]);
  const [studies, setStudies] = useState<ChartStudy[]>([]);

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    const onMessage = (event: MessageEvent) => {
      const data = event.data as LiveChartMessage;
      if (!isRecord(data) || data.type !== MSG_TYPE) return;
      if (typeof data.symbol === "string") setSymbol(coerceToGold(data.symbol));
      if (typeof data.interval === "string") {
        setInterval(normalizeInterval(data.interval));
      }
      if (data.theme === "light" || data.theme === "dark") setTheme(data.theme);
      if (Array.isArray(data.drawings)) setDrawings(data.drawings);
      if (data.recommendation === null || isRecord(data.recommendation)) {
        setRecommendation((data.recommendation ?? null) as Recommendation | null);
      }
      if (Array.isArray(data.targets)) {
        setTargets(data.targets.filter((n) => typeof n === "number"));
      }
      if (Array.isArray(data.studies)) setStudies(data.studies);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className="h-svh w-full bg-transparent">
      <TvChart
        symbol={symbol}
        interval={interval}
        theme={theme}
        locale={props.locale}
        direction={dirForLocale(props.locale)}
        embed
        drawings={drawings}
        recommendation={recommendation}
        targets={targets}
        studies={studies}
        className="h-full w-full bg-transparent"
      />
    </div>
  );
}
