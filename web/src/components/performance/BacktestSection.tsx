"use client";

import { useEffect, useMemo, useState } from "react";
import { FlaskConical } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { SkeletonBlock } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface BacktestSummary {
  id: number;
  strategyId: string;
  symbol: string;
  timeframe: string;
  status: string;
  tradeCount: number;
  winRate: number | null;
  expectancy: number | null;
  sharpeRatio: number | null;
  maxDrawdownPct: number | null;
  profitFactor: number | null;
  calibratedConfidence: number | null;
  confidenceLow: number | null;
  confidenceHigh: number | null;
  createdAt: number | null;
}

interface CurvePayload {
  available: boolean;
  reason?: string;
  equity?: { equity: number; drawdown: number; time: number | null }[];
  rollingWinRate?: { trade: number; winRate: number }[];
  tradeCount?: number;
}

const fmt = (v: number | null | undefined, digits = 2): string =>
  v == null || !Number.isFinite(v) ? "—" : v.toFixed(digits);

const pct = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? "—" : `${Math.round(v * 100)}%`;

/** Minimal dependency-free SVG line/area chart. */
function LineChart({
  points,
  className,
  fillArea = false,
  yFormat,
  referenceY,
}: {
  points: { x: number; y: number }[];
  className?: string;
  fillArea?: boolean;
  yFormat?: (v: number) => string;
  referenceY?: number;
}) {
  const W = 640;
  const H = 180;
  const PAD = 8;
  if (points.length < 2) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const sx = (x: number) => PAD + ((x - minX) / spanX) * (W - PAD * 2);
  const sy = (y: number) => H - PAD - ((y - minY) / spanY) * (H - PAD * 2);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`)
    .join(" ");
  const area = `${path} L${sx(maxX).toFixed(1)},${H - PAD} L${sx(minX).toFixed(1)},${H - PAD} Z`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={cn("h-44 w-full", className)}
      preserveAspectRatio="none"
      role="img"
    >
      {referenceY != null && referenceY >= minY && referenceY <= maxY && (
        <line
          x1={PAD}
          x2={W - PAD}
          y1={sy(referenceY)}
          y2={sy(referenceY)}
          stroke="currentColor"
          strokeOpacity={0.25}
          strokeDasharray="4 4"
          strokeWidth={1}
        />
      )}
      {fillArea && <path d={area} fill="currentColor" fillOpacity={0.12} />}
      <path d={path} fill="none" stroke="currentColor" strokeWidth={2} />
      <text
        x={PAD + 2}
        y={12}
        fontSize={10}
        fill="currentColor"
        fillOpacity={0.65}
      >
        {yFormat ? yFormat(maxY) : maxY.toFixed(2)}
      </text>
      <text
        x={PAD + 2}
        y={H - PAD - 2}
        fontSize={10}
        fill="currentColor"
        fillOpacity={0.65}
      >
        {yFormat ? yFormat(minY) : minY.toFixed(2)}
      </text>
    </svg>
  );
}

function MetricTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "bad" | "neutral";
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-lg font-bold",
          tone === "good" && "text-emerald-500",
          tone === "bad" && "text-red-500",
        )}
        dir="ltr"
      >
        {value}
      </p>
      {hint && (
        <p className="text-[10px] text-muted-foreground" dir="ltr">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Visual backtest results: metric tiles, equity curve, rolling win rate. */
export function BacktestSection() {
  const { t } = useLocale();
  const [backtests, setBacktests] = useState<BacktestSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [curves, setCurves] = useState<CurvePayload | null>(null);
  const [curvesLoading, setCurvesLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch("/api/backtests", { cache: "no-store" });
      const json = res.ok
        ? ((await res.json()) as { backtests?: BacktestSummary[] })
        : null;
      if (!alive) return;
      const list = json?.backtests ?? [];
      setBacktests(list);
      const first = list.find((b) => b.tradeCount > 0) ?? list[0];
      if (first) setSelectedId(first.id);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (selectedId == null) return;
    let alive = true;
    setCurves(null);
    setCurvesLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/backtests/${selectedId}/curves`, {
          cache: "no-store",
        });
        const json = res.ok ? ((await res.json()) as CurvePayload) : null;
        if (alive) setCurves(json ?? { available: false, reason: t("bt.curves_unavailable") });
      } finally {
        if (alive) setCurvesLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [selectedId, t]);

  const selected = useMemo(
    () => backtests?.find((b) => b.id === selectedId) ?? null,
    [backtests, selectedId],
  );

  return (
    <section id="backtests" className="scroll-mt-24 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <FlaskConical className="h-4.5 w-4.5 text-muted-foreground" />
          {t("bt.title")}
        </h2>
        {backtests && backtests.length > 0 && (
          <select
            dir="ltr"
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs"
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(Number(e.target.value))}
          >
            {backtests.map((b) => (
              <option key={b.id} value={b.id}>
                {b.strategyId} · {b.symbol} {b.timeframe} · {b.tradeCount} trades
              </option>
            ))}
          </select>
        )}
      </div>

      {!backtests && (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-20" />
          ))}
        </div>
      )}

      {backtests && backtests.length === 0 && (
        <p className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {t("bt.empty")}
        </p>
      )}

      {selected && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <MetricTile label={t("bt.trades")} value={String(selected.tradeCount)} />
            <MetricTile
              label={t("bt.win_rate")}
              value={pct(selected.winRate)}
              hint={
                selected.confidenceLow != null && selected.confidenceHigh != null
                  ? `CI ${fmt(selected.confidenceLow, 0)}–${fmt(selected.confidenceHigh, 0)}%`
                  : undefined
              }
              tone={(selected.winRate ?? 0) >= 0.5 ? "good" : "bad"}
            />
            <MetricTile
              label={t("bt.profit_factor")}
              value={fmt(selected.profitFactor)}
              tone={(selected.profitFactor ?? 0) >= 1 ? "good" : "bad"}
            />
            <MetricTile label={t("bt.expectancy")} value={fmt(selected.expectancy, 4)} />
            <MetricTile label={t("bt.sharpe")} value={fmt(selected.sharpeRatio)} />
            <MetricTile
              label={t("bt.max_drawdown")}
              value={selected.maxDrawdownPct != null ? `${fmt(selected.maxDrawdownPct)}%` : "—"}
              tone="bad"
            />
          </div>

          {curvesLoading && <SkeletonBlock className="h-44 w-full" />}

          {curves && !curves.available && (
            <p className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {curves.reason ?? t("bt.curves_unavailable")}
            </p>
          )}

          {curves?.available && (
            <div className="grid gap-4 lg:grid-cols-2">
              {curves.equity && curves.equity.length > 1 && (
                <div className="min-w-0 rounded-xl border border-border bg-card p-3">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    {t("bt.equity_curve")}
                  </p>
                  <LineChart
                    points={curves.equity.map((p, i) => ({
                      x: p.time ?? i,
                      y: p.equity,
                    }))}
                    className="text-emerald-500"
                    fillArea
                  />
                </div>
              )}
              {curves.rollingWinRate && curves.rollingWinRate.length > 1 && (
                <div className="min-w-0 rounded-xl border border-border bg-card p-3">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    {t("bt.rolling_win_rate")}
                  </p>
                  <LineChart
                    points={curves.rollingWinRate.map((p) => ({
                      x: p.trade,
                      y: p.winRate,
                    }))}
                    className="text-sky-500"
                    yFormat={(v) => `${Math.round(v * 100)}%`}
                    referenceY={0.5}
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
