import * as React from "react";

import { cn } from "@/lib/utils";

export type SurfaceElement = "div" | "section" | "article" | "aside" | "li";
export type SurfaceElevation = 0 | 1 | 2 | 3 | 4;
export type SurfacePadding = "none" | "sm" | "md" | "lg";

const ELEVATION: Record<SurfaceElevation, string> = {
  0: "elevation-0",
  1: "elevation-1",
  2: "elevation-2",
  3: "elevation-3",
  4: "elevation-4",
};

const PADDING: Record<SurfacePadding, string> = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
};

export interface SurfaceProps
  extends Omit<React.ComponentPropsWithRef<"div">, "children"> {
  children?: React.ReactNode;
  /** Rendered element. Use `li` inside a list so the semantics survive. */
  as?: SurfaceElement;
  elevation?: SurfaceElevation;
  padding?: SurfacePadding;
  /** Adds the hover lift + pointer affordance. Pair with a real control inside. */
  interactive?: boolean;
  /** Drops the border and background — for a padded region that must read as
   *  part of the page rather than as a card. */
  bare?: boolean;
}

/**
 * The one card surface. Everything that needs a raised, bordered container
 * composes this so elevation and radius stay consistent between the admin and
 * user consoles.
 */
export function Surface({
  children,
  as = "div",
  elevation = 1,
  padding = "md",
  interactive = false,
  bare = false,
  className,
  ...props
}: SurfaceProps) {
  const Tag = as as React.ElementType;

  return (
    <Tag
      className={cn(
        "rounded-[var(--radius-lg)]",
        bare
          ? "bg-transparent"
          : "border border-border bg-card text-card-foreground",
        // `interactive` owns its own shadow transition, so the static
        // elevation class would only fight it.
        interactive ? "elevation-interactive cursor-pointer" : ELEVATION[elevation],
        interactive && "hover:border-[var(--bento-card-hover-border)]",
        PADDING[padding],
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}
