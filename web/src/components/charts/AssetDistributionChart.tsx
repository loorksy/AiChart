"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatCurrency, type AssetSlice } from "@/lib/analytics";

const SLICE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "#8B6F47",
  "#A88B5E",
  "#6B5638",
];

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`;
}

/**
 * Interactive donut chart of capital allocation per asset.
 * Hovering/clicking a slice or legend row highlights it and shows details.
 */
export function AssetDistributionChart({
  data,
  className,
}: {
  data: AssetSlice[];
  className?: string;
}) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const total = data.reduce((s, d) => s + d.value, 0);

  if (data.length === 0 || total === 0) {
    return (
      <div
        className={cn(
          "flex h-48 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground",
          className,
        )}
      >
        لا توجد أصول لعرضها بعد.
      </div>
    );
  }

  const SIZE = 180;
  const R = 80;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  let cursor = 0;

  const slices = data.map((d, i) => {
    const portion = d.value / total;
    const start = cursor * 360;
    const end = (cursor + portion) * 360;
    cursor += portion;
    return { d, i, start, end, portion };
  });

  const active = activeIdx != null ? slices[activeIdx] : null;

  return (
    <div className={cn("flex flex-col items-center gap-4 sm:flex-row sm:items-center", className)}>
      <div className="relative shrink-0">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} role="img" aria-label="توزيع الأصول">
          {slices.map((s) => (
            <path
              key={s.d.symbol}
              d={arcPath(CX, CY, R, s.start, s.end)}
              fill={SLICE_COLORS[s.i % SLICE_COLORS.length]}
              stroke="var(--card)"
              strokeWidth="2"
              opacity={activeIdx == null || activeIdx === s.i ? 1 : 0.4}
              className="cursor-pointer transition-opacity"
              onMouseEnter={() => setActiveIdx(s.i)}
              onMouseLeave={() => setActiveIdx(null)}
              onClick={() => setActiveIdx((p) => (p === s.i ? null : s.i))}
            />
          ))}
          {/* inner hole */}
          <circle cx={CX} cy={CY} r={R * 0.58} fill="var(--card)" />
          <text
            x={CX}
            y={CY - 6}
            textAnchor="middle"
            className="fill-muted-foreground"
            style={{ fontSize: "10px" }}
          >
            {active ? active.d.symbol : "الإجمالي"}
          </text>
          <text
            x={CX}
            y={CY + 12}
            textAnchor="middle"
            className="fill-foreground font-mono"
            style={{ fontSize: "13px", fontWeight: 700 }}
          >
            {active
              ? `${(active.portion * 100).toFixed(0)}%`
              : formatCurrency(total, 0)}
          </text>
        </svg>
      </div>

      <ul className="w-full space-y-1.5">
        {slices.map((s) => (
          <li key={s.d.symbol}>
            <button
              type="button"
              onMouseEnter={() => setActiveIdx(s.i)}
              onMouseLeave={() => setActiveIdx(null)}
              onClick={() => setActiveIdx((p) => (p === s.i ? null : s.i))}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start transition",
                activeIdx === s.i ? "bg-secondary" : "hover:bg-secondary/50",
              )}
            >
              <span
                className="h-3 w-3 shrink-0 rounded-sm"
                style={{ background: SLICE_COLORS[s.i % SLICE_COLORS.length] }}
              />
              <span className="flex-1 text-sm font-medium" dir="ltr">
                {s.d.symbol}
              </span>
              <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                {(s.portion * 100).toFixed(1)}%
              </span>
              <span
                className={cn(
                  "w-16 text-end font-mono text-xs",
                  s.d.pnl >= 0 ? "text-chart-1" : "text-destructive",
                )}
                dir="ltr"
              >
                {s.d.pnl >= 0 ? "+" : ""}
                {formatCurrency(s.d.pnl)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
