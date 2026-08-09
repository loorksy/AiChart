import * as React from "react";

import { cn } from "@/lib/utils";

export type EmptyStateTone = "neutral" | "info" | "danger";
export type EmptyStateSize = "sm" | "md";

const ICON_TONE: Record<EmptyStateTone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  info: "border-[color-mix(in_srgb,var(--info)_35%,transparent)] bg-[color-mix(in_srgb,var(--info)_12%,transparent)] text-[var(--info)]",
  danger:
    "border-[color-mix(in_srgb,var(--destructive)_35%,transparent)] bg-[color-mix(in_srgb,var(--destructive)_12%,transparent)] text-destructive",
};

export interface EmptyStateProps
  extends Omit<React.ComponentPropsWithRef<"div">, "title" | "children"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Decorative only; hidden from assistive tech. The message carries meaning. */
  icon?: React.ReactNode;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  tone?: EmptyStateTone;
  size?: EmptyStateSize;
  /** Announce the state when it replaces content after a filter or refetch.
   *  Leave off for an empty state that is present on first paint — a live
   *  region that is already populated announces nothing anyway and only adds
   *  noise on later updates. */
  announce?: boolean;
}

/**
 * Nothing-here / nothing-found / it-broke. One component so the three read
 * identically across the admin and user consoles.
 */
export function EmptyState({
  title,
  description,
  icon,
  action,
  secondaryAction,
  tone = "neutral",
  size = "md",
  announce = false,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      role={announce ? "status" : undefined}
      aria-live={announce ? "polite" : undefined}
      className={cn(
        "flex flex-col items-center justify-center text-center",
        size === "sm" ? "gap-2 px-4 py-8" : "gap-3 px-6 py-12",
        className,
      )}
      {...props}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className={cn(
            "flex items-center justify-center rounded-full border",
            ICON_TONE[tone],
            size === "sm"
              ? "size-9 [&_svg]:size-4"
              : "size-12 [&_svg]:size-[1.375rem]",
          )}
        >
          {icon}
        </span>
      ) : null}

      <p
        className={cn(
          size === "sm" ? "type-subheading" : "type-heading",
          tone === "danger" && "text-destructive",
        )}
      >
        {title}
      </p>

      {description ? (
        <p className="type-caption max-w-[36ch] text-pretty">{description}</p>
      ) : null}

      {action || secondaryAction ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
