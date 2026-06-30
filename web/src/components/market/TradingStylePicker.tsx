"use client";

import { ChevronDown, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  STYLE_DEFAULT_INTERVAL,
  TRADING_STYLES,
  type TradingStyle,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const STYLE_LABELS: Record<TradingStyle, string> = {
  scalp: "سكالب",
  day: "يومي",
  swing: "سوينغ",
  position: "مركزي",
};

const CTRL =
  "inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-border/50 bg-background/80 text-xs font-medium text-foreground backdrop-blur-md transition hover:bg-background/95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function TradingStylePicker({
  value,
  onChange,
  onIntervalSuggest,
  className,
  compact,
}: {
  value: TradingStyle;
  onChange: (style: TradingStyle) => void;
  onIntervalSuggest?: (interval: string) => void;
  className?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const select = useCallback(
    async (style: TradingStyle) => {
      if (style === value) {
        setOpen(false);
        return;
      }
      setSaving(true);
      try {
        const res = await fetch("/api/user/trading-style", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trading_style: style, sync_interval: true }),
        });
        if (res.ok) {
          onChange(style);
          onIntervalSuggest?.(STYLE_DEFAULT_INTERVAL[style]);
        }
      } finally {
        setSaving(false);
        setOpen(false);
      }
    },
    [value, onChange, onIntervalSuggest],
  );

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={saving}
        className={cn(compact ? "aichart-pro-ctrl" : CTRL, "pointer-events-auto px-2")}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="نوع التداول"
      >
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <span>{STYLE_LABELS[value]}</span>
        )}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute start-0 top-full z-50 mt-1 min-w-[9rem] rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          {TRADING_STYLES.map((key) => (
            <li key={key}>
              <button
                type="button"
                role="option"
                aria-selected={key === value}
                onClick={() => void select(key)}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-xs hover:bg-accent",
                  key === value && "bg-accent/60 font-semibold text-primary",
                )}
              >
                <span>{STYLE_LABELS[key]}</span>
                <span className="text-[10px] text-muted-foreground" dir="ltr">
                  {STYLE_DEFAULT_INTERVAL[key]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
