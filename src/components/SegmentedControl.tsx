"use client";

import { useId, type ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export type SegmentedTone = "default" | "overlay";

export type SegmentedItem<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
  text?: string;
};

/**
 * Shared sliding-border segmented control used by theme and locale switchers.
 * One visual language: compact track, layoutId indicator, icon or short glyph.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  items,
  ariaLabel,
  tone = "default",
  className,
  testId,
}: {
  value: T;
  onChange: (value: T) => void;
  items: SegmentedItem<T>[];
  ariaLabel: string;
  tone?: SegmentedTone;
  className?: string;
  testId?: string;
}) {
  const layoutId = useId();
  const overlay = tone === "overlay";

  return (
    <div
      data-testid={testId}
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "relative inline-flex h-9 items-center rounded-lg p-0.5",
        overlay ? "bg-white/10" : "bg-input/50",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={item.label}
            title={item.label}
            onClick={() => onChange(item.value)}
            className={cn(
              "relative z-10 inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-[11px] font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0",
              overlay
                ? "focus-visible:ring-white/50"
                : "focus-visible:ring-ring",
              overlay
                ? active
                  ? "text-white"
                  : "text-white/55 hover:text-white"
                : active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active ? (
              <motion.span
                layoutId={layoutId}
                className={cn(
                  "absolute inset-0 -z-10 rounded-md border shadow-sm",
                  overlay
                    ? "border-white/25 bg-white/15"
                    : "border-border bg-background",
                )}
                transition={{ type: "spring", bounce: 0.18, duration: 0.35 }}
              />
            ) : null}
            {item.icon ?? <span aria-hidden>{item.text}</span>}
          </button>
        );
      })}
    </div>
  );
}
