"use client";

import type { ReactNode } from "react";
import type { CardActionDescriptor } from "@/lib/cards/cardTypes";
import { cn } from "@/lib/utils";

export function CardShell({
  title,
  children,
  actions,
  onAction,
  className,
}: {
  title: string;
  children: ReactNode;
  actions?: CardActionDescriptor[];
  onAction?: (action: string, payload?: Record<string, unknown>) => void;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-border/70 bg-card/80 p-3 text-sm shadow-sm backdrop-blur", className)}>
      <h3 className="mb-2 text-sm font-bold text-foreground">{title}</h3>
      <div className="space-y-2">{children}</div>
      {actions?.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map((a) => (
            <button
              key={a.action}
              type="button"
              onClick={() => onAction?.(a.action, a.payload)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                a.variant === "danger" && "border border-destructive/30 bg-destructive/10 text-destructive",
                a.variant === "secondary" && "border border-border bg-secondary/60 text-foreground",
                a.variant === "ghost" && "text-muted-foreground hover:bg-secondary/50",
                (!a.variant || a.variant === "primary") && "bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
