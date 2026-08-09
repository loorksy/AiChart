"use client";

import { cn } from "@/lib/utils";

/**
 * Decorative static chart backdrop — no API calls, no live stream.
 * Used on login/marketing surfaces where live candles are unavailable.
 */
export function ChartBackdrop({ className }: { className?: string }) {
  const bars = [
    42, 55, 48, 62, 58, 70, 65, 78, 72, 85, 80, 92, 88, 95, 90, 86, 94, 98,
    92, 88, 96, 100, 94, 90, 97, 102, 96, 91, 99, 104,
  ];
  return (
    <div
      className={cn(
        "relative h-full w-full overflow-hidden bg-[#0a0e17]",
        className,
      )}
      aria-hidden
    >
      <svg
        className="absolute inset-0 h-full w-full opacity-40"
        preserveAspectRatio="none"
        viewBox="0 0 300 120"
      >
        <defs>
          <linearGradient id="chart-bg-up" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
          </linearGradient>
        </defs>
        {bars.map((h, i) => {
          const x = i * 10 + 4;
          const bodyH = h * 0.55;
          const y = 100 - bodyH;
          const isUp = i === 0 || h >= bars[i - 1]!;
          const color = isUp ? "#22c55e" : "#ef4444";
          return (
            <g key={i}>
              <line
                x1={x + 3}
                y1={y - 4}
                x2={x + 3}
                y2={100}
                stroke={color}
                strokeWidth="0.6"
                opacity="0.5"
              />
              <rect
                x={x}
                y={y}
                width="6"
                height={bodyH}
                fill={color}
                opacity="0.85"
              />
            </g>
          );
        })}
        <polyline
          fill="url(#chart-bg-up)"
          points={`0,100 ${bars.map((h, i) => `${i * 10 + 7},${100 - h * 0.55}`).join(" ")} 300,100`}
        />
      </svg>
      <div className="absolute inset-0 bg-gradient-to-t from-[#0a0e17] via-transparent to-[#0a0e17]/60" />
    </div>
  );
}
