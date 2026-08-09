"use client";

import { Eye, EyeOff, Layers, Trash2 } from "lucide-react";
import { useRef, useState, useEffect } from "react";
import type { ChartDrawing } from "@/lib/chartDrawings";
import { cn } from "@/lib/utils";

const CTRL =
  "inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-border/50 bg-background/80 text-xs font-medium text-foreground backdrop-blur-md transition hover:bg-background/95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const LAYER_LABELS: Record<string, string> = {
  stop_loss: "وقف الخسارة",
  take_profit: "جني الأرباح",
  entry: "الدخول",
  support: "دعم",
  resistance: "مقاومة",
  price_line: "خط سعر",
  forecast_path: "مسار تنبؤي",
  range_box: "نطاق",
  fibonacci: "فيبوناتشي",
};

function layerLabel(d: ChartDrawing): string {
  const role = d.semanticRole ?? d.type;
  return d.label?.trim() || LAYER_LABELS[role] || LAYER_LABELS[d.type] || d.type;
}

export function DrawingLayersMenu({
  drawings,
  hidden,
  onToggleLayer,
  onToggleAll,
  onClear,
  compact,
}: {
  drawings: ChartDrawing[];
  hidden: Set<number>;
  onToggleLayer: (index: number) => void;
  onToggleAll: (hide: boolean) => void;
  onClear: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const count = drawings.length;

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          compact ? "aichart-pro-ctrl" : CTRL,
          "pointer-events-auto px-2",
          count > 0 && !compact && "ring-1 ring-primary/30",
          count > 0 && compact && "aichart-pro-ctrl--primary",
        )}
        title="أدوات الرسم AI"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Layers className="h-3.5 w-3.5" />
        <span className={compact ? "hide-sm" : "hidden sm:inline"}>رسومات</span>
        {count > 0 && (
          <span className="rounded-full bg-primary/15 px-1.5 text-[10px] text-primary">
            {count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute start-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-popover p-2 shadow-lg">
          {count === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              لا رسومات — شغّل التحليل أولاً
            </p>
          ) : (
            <>
              <ul className="max-h-48 space-y-0.5 overflow-y-auto">
                {drawings.map((d, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => onToggleLayer(i)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent"
                    >
                      {hidden.has(i) ? (
                        <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <Eye className="h-3.5 w-3.5 text-primary" />
                      )}
                      <span className="truncate">{layerLabel(d)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-1 border-t border-border pt-2">
                <button
                  type="button"
                  onClick={() => onToggleAll(hidden.size === 0)}
                  className="flex-1 rounded-md px-2 py-1 text-[10px] hover:bg-accent"
                >
                  {hidden.size === 0 ? "إخفاء الكل" : "إظهار الكل"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClear();
                    setOpen(false);
                  }}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3 w-3" />
                  مسح
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
