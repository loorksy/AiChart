"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { formatCurrency, type EquityPoint } from "@/lib/analytics";

/**
 * Interactive SVG area/line chart for the cumulative equity curve.
 * Responds to hover (and touch) to surface a tooltip + crosshair.
 */
export function InteractivePerformanceChart({
  data,
  height = 220,
  className,
}: {
  data: EquityPoint[];
  height?: number;
  className?: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const W = 600;
  const H = height;
  const PAD = { top: 16, right: 12, bottom: 24, left: 12 };

  const { points, areaPath, linePath, minV, maxV, zeroY } = useMemo(() => {
    if (data.length === 0) {
      return {
        points: [] as { x: number; y: number; d: EquityPoint }[],
        areaPath: "",
        linePath: "",
        minV: 0,
        maxV: 0,
        zeroY: H - PAD.bottom,
      };
    }
    const values = data.map((d) => d.value);
    let lo = Math.min(0, ...values);
    let hi = Math.max(0, ...values);
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const xFor = (i: number) =>
      PAD.left + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
    const yFor = (v: number) =>
      PAD.top + innerH - ((v - lo) / (hi - lo)) * innerH;

    const pts = data.map((d, i) => ({ x: xFor(i), y: yFor(d.value), d }));
    const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
    const area =
      `M${pts[0].x},${H - PAD.bottom} ` +
      pts.map((p) => `L${p.x},${p.y}`).join(" ") +
      ` L${pts[pts.length - 1].x},${H - PAD.bottom} Z`;

    return {
      points: pts,
      areaPath: area,
      linePath: line,
      minV: lo,
      maxV: hi,
      zeroY: yFor(0),
    };
  }, [data, H]);

  function handleMove(e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>) {
    if (points.length === 0) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const clientX =
      "touches" in e ? e.touches[0]?.clientX ?? 0 : (e as React.MouseEvent).clientX;
    const ratio = (clientX - rect.left) / rect.width;
    const x = ratio * W;
    let nearest = 0;
    let best = Infinity;
    points.forEach((p, i) => {
      const dist = Math.abs(p.x - x);
      if (dist < best) {
        best = dist;
        nearest = i;
      }
    });
    setHoverIdx(nearest);
  }

  if (data.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground",
          className,
        )}
        style={{ height }}
      >
        لا توجد بيانات أداء بعد — ستظهر بعد إغلاق أول صفقة.
      </div>
    );
  }

  const active = hoverIdx != null ? points[hoverIdx] : null;
  const lastValue = data[data.length - 1].value;
  const positive = lastValue >= 0;

  return (
    <div className={cn("relative w-full", className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        style={{ height }}
        preserveAspectRatio="none"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
        onTouchStart={handleMove}
        onTouchMove={handleMove}
        role="img"
        aria-label="منحنى الأداء التراكمي"
      >
        <defs>
          <linearGradient id="perfGradient" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor={positive ? "var(--chart-1)" : "var(--destructive)"}
              stopOpacity="0.28"
            />
            <stop
              offset="100%"
              stopColor={positive ? "var(--chart-1)" : "var(--destructive)"}
              stopOpacity="0"
            />
          </linearGradient>
        </defs>

        {/* zero baseline */}
        {minV < 0 && maxV > 0 && (
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={zeroY}
            y2={zeroY}
            stroke="var(--border)"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
        )}

        <path d={areaPath} fill="url(#perfGradient)" />
        <path
          d={linePath}
          fill="none"
          stroke={positive ? "var(--chart-1)" : "var(--destructive)"}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {active && (
          <>
            <line
              x1={active.x}
              x2={active.x}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="var(--accent-gold)"
              strokeWidth="1"
            />
            <circle
              cx={active.x}
              cy={active.y}
              r="4"
              fill="var(--accent-gold)"
              stroke="var(--background)"
              strokeWidth="2"
            />
          </>
        )}
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg"
          style={{
            left: `${(active.x / W) * 100}%`,
            transform: "translateX(-50%)",
          }}
        >
          <p className="font-mono font-bold" dir="ltr">
            {formatCurrency(active.d.value)} USD
          </p>
          <p className="text-muted-foreground" dir="ltr">
            {active.d.date} · {active.d.label}
          </p>
          <p
            className={cn(
              "font-mono",
              active.d.pnl >= 0 ? "text-chart-1" : "text-destructive",
            )}
            dir="ltr"
          >
            {active.d.pnl >= 0 ? "+" : ""}
            {formatCurrency(active.d.pnl)}
          </p>
        </div>
      )}
    </div>
  );
}
