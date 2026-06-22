"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  CandlestickChart,
  AreaChart,
  GitCompareArrows,
  SlidersHorizontal,
  TrendingUp,
  TrendingDown,
} from "lucide-react";

type ActionFn = (action: string, payload: any) => void;

/* ============================================================
   أدوات مشتركة
   ============================================================ */

const EMERALD = "#10b981";
const ROSE = "#f43f5e";
const BLUE = "#3b82f6";
const AMBER = "#f59e0b";

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** يحوّل سلسلة نقاط إلى مسار خطّي SVG ضمن مساحة معطاة */
function buildLinePath(
  points: number[],
  width: number,
  height: number,
  pad = 4,
) {
  if (!points.length) return "";
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  return points
    .map((p, i) => {
      const x = pad + i * stepX;
      const y = pad + innerH - ((p - min) / span) * innerH;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function fmt(n: number, d = 2) {
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

/* ============================================================
   53. candles_mini — شموع يابانية مصغّرة SVG تفاعلية
   ============================================================ */

export function CandlesMini({
  candles = [],
  symbol = "BTCUSDT",
  onAction,
}: {
  candles?: { o: number; h: number; l: number; c: number }[];
  symbol?: string;
  onAction?: ActionFn;
}) {
  const data =
    candles.length > 0
      ? candles
      : [
          { o: 100, h: 106, l: 98, c: 104 },
          { o: 104, h: 108, l: 102, c: 103 },
          { o: 103, h: 105, l: 99, c: 100 },
          { o: 100, h: 104, l: 97, c: 102 },
          { o: 102, h: 110, l: 101, c: 109 },
          { o: 109, h: 112, l: 106, c: 107 },
          { o: 107, h: 109, l: 103, c: 108 },
          { o: 108, h: 114, l: 107, c: 113 },
        ];

  const [hover, setHover] = useState<number | null>(null);

  const W = 320;
  const H = 150;
  const PAD = 8;
  const lows = data.map((d) => d.l);
  const highs = data.map((d) => d.h);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = max - min || 1;
  const innerH = H - PAD * 2;
  const slot = (W - PAD * 2) / data.length;
  const bodyW = clamp(slot * 0.6, 3, 18);

  const yOf = (v: number) => PAD + innerH - ((v - min) / span) * innerH;

  const last = data[data.length - 1];
  const first = data[0];
  const up = last.c >= first.o;
  const changePct = ((last.c - first.o) / (first.o || 1)) * 100;

  return (
    <div
      dir="rtl"
      className="w-full max-w-md rounded-2xl border border-border bg-card/80 p-4 shadow-lg backdrop-blur-md"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <CandlestickChart className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-semibold text-foreground">{symbol}</div>
            <div className="text-[11px] text-muted-foreground">شموع مصغّرة</div>
          </div>
        </div>
        <div className="text-left">
          <div className="text-sm font-bold text-foreground">{fmt(last.c)}</div>
          <div
            className={cn(
              "flex items-center justify-end gap-0.5 text-[11px] font-medium",
              up ? "text-emerald-500" : "text-rose-500",
            )}
          >
            {up ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {changePct >= 0 ? "+" : ""}
            {fmt(changePct)}%
          </div>
        </div>
      </div>

      <div className="relative rounded-xl bg-background/60 p-1">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          onMouseLeave={() => setHover(null)}
        >
          {/* خطوط الشبكة */}
          {[0.25, 0.5, 0.75].map((g) => (
            <line
              key={g}
              x1={PAD}
              x2={W - PAD}
              y1={PAD + innerH * g}
              y2={PAD + innerH * g}
              stroke="currentColor"
              className="text-border"
              strokeWidth={0.5}
              strokeDasharray="3 3"
            />
          ))}

          {data.map((d, i) => {
            const cx = PAD + slot * i + slot / 2;
            const isUp = d.c >= d.o;
            const color = isUp ? EMERALD : ROSE;
            const yHigh = yOf(d.h);
            const yLow = yOf(d.l);
            const yO = yOf(d.o);
            const yC = yOf(d.c);
            const bodyTop = Math.min(yO, yC);
            const bodyH = Math.max(Math.abs(yO - yC), 1.5);
            const active = hover === i;
            return (
              <g
                key={i}
                onMouseEnter={() => setHover(i)}
                style={{ cursor: "pointer" }}
              >
                {/* منطقة التقاط شفافة */}
                <rect
                  x={PAD + slot * i}
                  y={0}
                  width={slot}
                  height={H}
                  fill="transparent"
                />
                <line
                  x1={cx}
                  x2={cx}
                  y1={yHigh}
                  y2={yLow}
                  stroke={color}
                  strokeWidth={1}
                  opacity={active ? 1 : 0.85}
                />
                <rect
                  x={cx - bodyW / 2}
                  y={bodyTop}
                  width={bodyW}
                  height={bodyH}
                  rx={1.5}
                  fill={color}
                  opacity={active ? 1 : 0.9}
                  style={{ transition: "opacity 0.15s" }}
                />
              </g>
            );
          })}
        </svg>

        {hover !== null && (
          <div className="pointer-events-none absolute right-2 top-2 rounded-lg border border-border bg-card/95 px-2 py-1 text-[10px] leading-tight text-foreground shadow-md backdrop-blur-md">
            <div className="flex gap-2">
              <span className="text-muted-foreground">فتح</span>
              <span>{fmt(data[hover].o)}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground">أعلى</span>
              <span className="text-emerald-500">{fmt(data[hover].h)}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground">أدنى</span>
              <span className="text-rose-500">{fmt(data[hover].l)}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground">إغلاق</span>
              <span>{fmt(data[hover].c)}</span>
            </div>
          </div>
        )}
      </div>

      <button
        onClick={() =>
          onAction?.("submit_prompt", {
            text: `حلّل حركة الشموع الأخيرة على ${symbol} وأعطني الاتجاه المتوقّع.`,
          })
        }
        className="mt-3 w-full rounded-xl bg-primary/10 py-2 text-sm font-medium text-primary transition hover:bg-primary/20"
      >
        تحليل الشموع
      </button>
    </div>
  );
}

/* ============================================================
   54. area_spark — مخطّط مساحي مصغّر بتدرّج
   ============================================================ */

export function AreaSpark({
  points = [],
  changePct,
  symbol = "السعر",
  onAction,
}: {
  points?: number[];
  changePct?: number;
  symbol?: string;
  onAction?: ActionFn;
}) {
  const data =
    points.length > 0
      ? points
      : [12, 14, 13, 16, 15, 18, 17, 21, 20, 24, 23, 27];

  const W = 320;
  const H = 110;
  const PAD = 6;

  const last = data[data.length - 1];
  const first = data[0];
  const pct =
    typeof changePct === "number"
      ? changePct
      : ((last - first) / (first || 1)) * 100;
  const up = pct >= 0;
  const color = up ? EMERALD : ROSE;

  const linePath = buildLinePath(data, W, H, PAD);
  const areaPath = `${linePath} L ${W - PAD} ${H - PAD} L ${PAD} ${H - PAD} Z`;
  const gid = `area-grad-${up ? "up" : "down"}`;

  return (
    <div
      dir="rtl"
      className="w-full max-w-md rounded-2xl border border-border bg-card/80 p-4 shadow-lg backdrop-blur-md"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <AreaChart className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold text-foreground">{symbol}</span>
        </div>
        <span
          className={cn(
            "flex items-center gap-0.5 rounded-lg px-2 py-0.5 text-xs font-semibold",
            up
              ? "bg-emerald-500/10 text-emerald-500"
              : "bg-rose-500/10 text-rose-500",
          )}
        >
          {up ? (
            <TrendingUp className="h-3 w-3" />
          ) : (
            <TrendingDown className="h-3 w-3" />
          )}
          {pct >= 0 ? "+" : ""}
          {fmt(pct)}%
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.45" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gid})`} />
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>

      <button
        onClick={() =>
          onAction?.("submit_prompt", {
            text: `ما الاتجاه العام لـ ${symbol} حسب آخر الحركة؟`,
          })
        }
        className="mt-3 w-full rounded-xl bg-primary/10 py-2 text-sm font-medium text-primary transition hover:bg-primary/20"
      >
        عرض التفاصيل
      </button>
    </div>
  );
}

/* ============================================================
   55. compare_chart — خطّان للمقارنة بين رمزين
   ============================================================ */

export function CompareChart({
  seriesA,
  seriesB,
  onAction,
}: {
  seriesA?: { label: string; points: number[] };
  seriesB?: { label: string; points: number[] };
  onAction?: ActionFn;
}) {
  const A =
    seriesA && seriesA.points?.length
      ? seriesA
      : { label: "BTC", points: [20, 22, 21, 25, 24, 28, 30, 29, 33] };
  const B =
    seriesB && seriesB.points?.length
      ? seriesB
      : { label: "ETH", points: [18, 19, 21, 20, 23, 22, 24, 27, 26] };

  // أزرار تبديل إظهار/إخفاء كل سلسلة
  const [showA, setShowA] = useState(true);
  const [showB, setShowB] = useState(true);

  const W = 320;
  const H = 150;
  const PAD = 8;

  // مقياس موحّد للسلسلتين كي تكون المقارنة عادلة
  const all = [...A.points, ...B.points];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const innerH = H - PAD * 2;
  const innerW = W - PAD * 2;

  const pathFor = (pts: number[]) =>
    pts
      .map((p, i) => {
        const x = PAD + (i / (pts.length - 1 || 1)) * innerW;
        const y = PAD + innerH - ((p - min) / span) * innerH;
        return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");

  return (
    <div
      dir="rtl"
      className="w-full max-w-md rounded-2xl border border-border bg-card/80 p-4 shadow-lg backdrop-blur-md"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <GitCompareArrows className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold text-foreground">
            مقارنة الأداء
          </span>
        </div>
      </div>

      {/* وسيلة الإيضاح — قابلة للنقر للإظهار/الإخفاء */}
      <div className="mb-2 flex items-center gap-3">
        <button
          onClick={() => setShowA((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition",
            showA ? "bg-blue-500/10 text-blue-500" : "bg-muted text-muted-foreground",
          )}
        >
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: BLUE, opacity: showA ? 1 : 0.4 }}
          />
          {A.label}
        </button>
        <button
          onClick={() => setShowB((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition",
            showB ? "bg-amber-500/10 text-amber-500" : "bg-muted text-muted-foreground",
          )}
        >
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: AMBER, opacity: showB ? 1 : 0.4 }}
          />
          {B.label}
        </button>
      </div>

      <div className="rounded-xl bg-background/60 p-1">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
          {[0.25, 0.5, 0.75].map((g) => (
            <line
              key={g}
              x1={PAD}
              x2={W - PAD}
              y1={PAD + innerH * g}
              y2={PAD + innerH * g}
              stroke="currentColor"
              className="text-border"
              strokeWidth={0.5}
              strokeDasharray="3 3"
            />
          ))}
          {showA && (
            <path
              d={pathFor(A.points)}
              fill="none"
              stroke={BLUE}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {showB && (
            <path
              d={pathFor(B.points)}
              fill="none"
              stroke={AMBER}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
        </svg>
      </div>

      <button
        onClick={() =>
          onAction?.("submit_prompt", {
            text: `قارن بين ${A.label} و ${B.label} وأيّهما أقوى أداءً الآن؟`,
          })
        }
        className="mt-3 w-full rounded-xl bg-primary/10 py-2 text-sm font-medium text-primary transition hover:bg-primary/20"
      >
        طلب مقارنة تفصيلية
      </button>
    </div>
  );
}

/* ============================================================
   56. range_slider_chart — sparkline مع مزلاق نطاق زمني
   ============================================================ */

export function RangeSliderChart({
  points = [],
  symbol = "السعر",
  onAction,
}: {
  points?: number[];
  symbol?: string;
  onAction?: ActionFn;
}) {
  const data =
    points.length > 0
      ? points
      : [
          10, 11, 9, 12, 14, 13, 15, 17, 16, 18, 20, 19, 22, 21, 24, 26, 25, 28,
          27, 30, 32, 31, 34, 36,
        ];

  // نطاقات زمنية جاهزة + مزلاق نسبة العرض
  const ranges = [
    { key: "all", label: "الكل", frac: 1 },
    { key: "60", label: "60%", frac: 0.6 },
    { key: "30", label: "30%", frac: 0.3 },
  ];
  const [rangeKey, setRangeKey] = useState("all");
  const [frac, setFrac] = useState(1);

  const count = Math.max(2, Math.round(data.length * frac));
  const view = data.slice(data.length - count);

  const W = 320;
  const H = 120;
  const PAD = 6;

  const last = view[view.length - 1];
  const first = view[0];
  const pct = ((last - first) / (first || 1)) * 100;
  const up = pct >= 0;
  const color = up ? EMERALD : ROSE;

  const linePath = buildLinePath(view, W, H, PAD);
  const gid = `range-grad-${up ? "up" : "down"}`;
  const areaPath = `${linePath} L ${W - PAD} ${H - PAD} L ${PAD} ${H - PAD} Z`;

  const applyRange = (key: string, f: number) => {
    setRangeKey(key);
    setFrac(f);
  };

  return (
    <div
      dir="rtl"
      className="w-full max-w-md rounded-2xl border border-border bg-card/80 p-4 shadow-lg backdrop-blur-md"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <SlidersHorizontal className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-semibold text-foreground">{symbol}</div>
            <div className="text-[11px] text-muted-foreground">
              {view.length} نقطة معروضة
            </div>
          </div>
        </div>
        <span
          className={cn(
            "rounded-lg px-2 py-0.5 text-xs font-semibold",
            up
              ? "bg-emerald-500/10 text-emerald-500"
              : "bg-rose-500/10 text-rose-500",
          )}
        >
          {pct >= 0 ? "+" : ""}
          {fmt(pct)}%
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.4" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gid})`} />
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>

      {/* أزرار نطاقات سريعة */}
      <div className="mt-3 flex items-center gap-2">
        {ranges.map((r) => (
          <button
            key={r.key}
            onClick={() => applyRange(r.key, r.frac)}
            className={cn(
              "flex-1 rounded-lg py-1 text-xs font-medium transition",
              rangeKey === r.key
                ? "bg-primary/15 text-primary"
                : "bg-muted text-muted-foreground hover:bg-muted/70",
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* مزلاق نطاق زمني دقيق */}
      <div className="mt-3">
        <input
          type="range"
          min={10}
          max={100}
          step={5}
          value={Math.round(frac * 100)}
          onChange={(e) => {
            const f = Number(e.target.value) / 100;
            setFrac(f);
            setRangeKey("custom");
          }}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
        />
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>أقدم</span>
          <span>أحدث</span>
        </div>
      </div>

      <button
        onClick={() =>
          onAction?.("submit_prompt", {
            text: `حلّل آخر ${view.length} نقطة من حركة ${symbol}.`,
          })
        }
        className="mt-3 w-full rounded-xl bg-primary/10 py-2 text-sm font-medium text-primary transition hover:bg-primary/20"
      >
        تحليل النطاق المحدّد
      </button>
    </div>
  );
}

/* ============================================================
   خريطة التصدير
   ============================================================ */

export const CHART_WIDGETS_EXT = {
  candles_mini: CandlesMini,
  area_spark: AreaSpark,
  compare_chart: CompareChart,
  range_slider_chart: RangeSliderChart,
};
