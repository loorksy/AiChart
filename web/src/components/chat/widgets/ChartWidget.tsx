"use client";

import React, { useState } from "react";
import { LineChart, Maximize2 } from "lucide-react";
import { ChartLightbox } from "@/components/ui/chart-lightbox";

interface ChartWidgetProps {
  src?: string;
  symbol?: string;
  interval?: string;
  title?: string;
}

function isValidChartSrc(src: string): boolean {
  return (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("/api/") ||
    src.startsWith("data:image/")
  );
}

export default function ChartWidget({
  src,
  symbol = "BTCUSDT",
  interval = "1h",
  title,
}: ChartWidgetProps) {
  const [showLightbox, setShowLightbox] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  if (!src || !isValidChartSrc(src)) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 p-4 text-center">
        <LineChart className="h-6 w-6 text-muted-foreground animate-pulse mb-1" />
        <p className="text-xs font-medium text-foreground">{symbol} ({interval})</p>
        <p className="text-[10px] text-muted-foreground mt-1">بانتظار توليد الشارت...</p>
      </div>
    );
  }

  if (imgFailed) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 p-4 text-center">
        <LineChart className="h-6 w-6 text-muted-foreground mb-1" />
        <p className="text-xs font-medium text-foreground">{symbol} ({interval})</p>
        <p className="text-[10px] text-muted-foreground mt-1">تعذّر تحميل الشارت</p>
      </div>
    );
  }

  return (
    <>
      <div className="group relative overflow-hidden rounded-xl border border-border bg-card/30 hover:border-primary/30 transition-all duration-300 shadow-md">
        <div className="absolute top-2 left-2 right-2 flex items-center justify-between z-10">
          <span className="rounded bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm border border-white/5">
            {symbol} ({interval})
          </span>
          <button
            onClick={() => setShowLightbox(true)}
            className="rounded bg-black/60 p-1 text-white opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm border border-white/5 hover:bg-black/80"
            title="تكبير الشارت"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <img
          src={src}
          alt={title || `شارت ${symbol}`}
          onClick={() => setShowLightbox(true)}
          onError={() => setImgFailed(true)}
          className="w-full h-auto max-h-40 object-cover cursor-zoom-in group-hover:scale-[1.01] transition-transform duration-300"
          loading="lazy"
        />
      </div>

      {showLightbox && (
        <ChartLightbox
          src={src}
          alt={title || `${symbol} (${interval})`}
          onClose={() => setShowLightbox(false)}
        />
      )}
    </>
  );
}
