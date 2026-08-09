"use client";

/**
 * Circular confidence gauge for a Quant Agent analysis.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `src/views/ai-analysis/components/FastAnalysisReport.vue` (the
 * `<a-progress type="circle" :width="80">` confidence ring and its
 * `confidenceColor` threshold ladder at `:587-592`).
 *
 * What changed: ant-design-vue is not in this tree, so the ring is hand-drawn
 * SVG the same way `QuantRecommendationCard`'s smaller ring already is; the
 * three hard-coded hexes (`#52c41a` / `--primary-color` / `#faad14`) become the
 * `success` / `info` / `warning` semantic tokens, because DESIGN.md reserves
 * `buy`/`sell` for trade DIRECTION and confidence is not a direction. And
 * upstream's `result?.confidence || 50` fallback is dropped: a run that
 * produced no confidence renders an empty track and an em dash rather than a
 * fabricated 50%.
 */
import { useId } from "react";
import { cn } from "@/lib/utils";

export type ConfidenceGaugeTone = "success" | "info" | "warning" | "muted";

const TONE_STROKE: Record<ConfidenceGaugeTone, string> = {
  success: "stroke-success",
  info: "stroke-info",
  warning: "stroke-warning",
  muted: "stroke-muted-foreground",
};

/** QuantDinger's `confidenceColor` ladder, verbatim thresholds. */
export function confidenceTone(confidence: number | null): ConfidenceGaugeTone {
  if (confidence == null || !Number.isFinite(confidence)) return "muted";
  if (confidence >= 70) return "success";
  if (confidence >= 50) return "info";
  return "warning";
}

export interface ConfidenceGaugeProps {
  /** 0–100, or `null` when the run produced no confidence at all. */
  value: number | null;
  /** Rendered under the ring. Omit for the compact in-card variant. */
  label?: string;
  /** Outer diameter in px. Upstream's ring is 80. */
  size?: number;
  className?: string;
}

export function ConfidenceGauge({ value, label, size = 80, className }: ConfidenceGaugeProps) {
  const id = useId();
  const known = value != null && Number.isFinite(value);
  const pct = known ? Math.max(0, Math.min(100, value)) : 0;
  const tone = confidenceTone(known ? pct : null);

  // Geometry in a fixed 100×100 user space so `size` only scales the box —
  // the stroke stays proportional at 44px in a chat card and 80px on the page.
  const radius = 42;
  const circumference = 2 * Math.PI * radius;

  return (
    <div
      className={cn("flex shrink-0 flex-col items-center gap-1", className)}
      style={{ width: size }}
    >
      <div className="relative" style={{ width: size, height: size }} role="img" aria-labelledby={id}>
        <span id={id} className="sr-only">
          {label ? `${label}: ` : ""}
          {known ? `${Math.round(pct)}%` : "—"}
        </span>
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="8" className="stroke-border" />
          {known ? (
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - pct / 100)}
              className={TONE_STROKE[tone]}
            />
          ) : null}
        </svg>
        <span
          className="absolute inset-0 flex items-center justify-center font-mono font-bold text-foreground"
          style={{ fontSize: Math.max(11, Math.round(size * 0.22)) }}
        >
          {known ? `${Math.round(pct)}%` : "—"}
        </span>
      </div>
      {label ? (
        <span className="text-[10px] uppercase tracking-[0.03em] text-muted-foreground">{label}</span>
      ) : null}
    </div>
  );
}
