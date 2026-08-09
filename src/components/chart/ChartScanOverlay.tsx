"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Printer-scanner style overlay shown while the AI analyzes the chart.
 * Pure CSS sweep (keyframes live in klinecharts-pro-aichart.css) — a luminous
 * beam travels top→bottom over the candle area, leaving a faint scanned trail.
 * pointer-events-none so the chart stays interactive underneath.
 */
export function ChartScanOverlay({
  active,
  className,
}: {
  active?: boolean;
  className?: string;
}) {
  // Keep mounted briefly after deactivation so the fade-out can play.
  const [mounted, setMounted] = useState(Boolean(active));

  useEffect(() => {
    if (active) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), 320);
    return () => clearTimeout(t);
  }, [active]);

  if (!mounted) return null;

  return (
    <div
      className={cn(
        // Positioned over the candle area only (clears the period + drawing bars).
        "aichart-scan-frame pointer-events-none z-[35] overflow-hidden",
        active ? "aichart-scan--on" : "aichart-scan--off",
        className,
      )}
      aria-hidden
    >
      {/* Dim wash so the scanned area reads as "under the scanner glass". */}
      <div className="aichart-scan__wash absolute inset-0" />

      {/* Reticle corners (scanner frame). */}
      <span className="aichart-scan__corner aichart-scan__corner--tl" />
      <span className="aichart-scan__corner aichart-scan__corner--tr" />
      <span className="aichart-scan__corner aichart-scan__corner--bl" />
      <span className="aichart-scan__corner aichart-scan__corner--br" />

      {/* The travelling beam + its soft glow band. */}
      <div className="aichart-scan__beam absolute inset-x-0">
        <div className="aichart-scan__beam-glow" />
        <div className="aichart-scan__beam-line" />
      </div>

      {/* Status chip. */}
      <div className="aichart-scan__chip">
        <span className="aichart-scan__chip-dot" />
        <span>يُحلِّل الشارت…</span>
      </div>
    </div>
  );
}

export default ChartScanOverlay;
