"use client";

import { useState } from "react";
import { LineChart } from "lucide-react";
import { cn } from "@/lib/utils";

/** Normalize legacy chart-image paths to the bridge chart route. */
export function normalizeChartImageSrc(src: string, recId?: number): string {
  if (src.startsWith("/api/chart-image/") && recId) {
    return `/api/agent/chart/${recId}`;
  }
  return src;
}

export function RecommendationChartImage({
  src,
  recId,
  symbol,
  className,
}: {
  src: string;
  recId?: number;
  symbol: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const resolved = normalizeChartImageSrc(src, recId);

  if (failed) {
    return (
      <div
        className={cn(
          "mt-2 flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 p-3 text-center",
          className,
        )}
      >
        <LineChart className="mb-1 h-5 w-5 text-muted-foreground" />
        <p className="text-[10px] text-muted-foreground">الشارت غير متاح حالياً</p>
      </div>
    );
  }

  return (
    <img
      src={resolved}
      alt={`شارت ${symbol}`}
      className={cn(
        "mt-2 w-full max-h-40 rounded-lg border border-border object-cover object-center",
        className,
      )}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
