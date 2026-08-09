import * as React from "react";

import { cn } from "@/lib/utils";

export type PageShellWidth =
  | "form"
  | "reading"
  | "panel"
  | "dashboard"
  | "full";
export type PageShellGap = "none" | "sm" | "md" | "lg";

const WIDTH: Record<PageShellWidth, string> = {
  form: "max-w-[var(--container-form)]",
  reading: "max-w-[var(--container-reading)]",
  panel: "max-w-[var(--container-panel)]",
  dashboard: "max-w-[var(--container-dashboard)]",
  full: "max-w-full",
};

const GAP: Record<PageShellGap, string> = {
  none: "",
  sm: "space-y-4",
  md: "space-y-6",
  lg: "space-y-8",
};

export interface PageShellProps
  extends Omit<React.ComponentPropsWithRef<"div">, "children"> {
  children: React.ReactNode;
  width?: PageShellWidth;
  gap?: PageShellGap;
  /** Applies the app's page padding (incl. the mobile safe-area inset).
   *  Off by default because AppConsoleShell already pads its <main>; turn it
   *  on for routes rendered outside that shell. */
  padded?: boolean;
  /** `main` only when this shell is the page's own landmark. Inside
   *  AppConsoleShell the <main> already exists, so the default is a plain div
   *  — two <main> landmarks on one page is a real screen-reader defect. */
  as?: "div" | "main" | "section";
}

/**
 * Measure + vertical rhythm for a console page. Deliberately owns no padding
 * of its own by default so it can be dropped inside an already-padded shell
 * without doubling the gutter.
 */
export function PageShell({
  children,
  width = "panel",
  gap = "md",
  padded = false,
  as = "div",
  className,
  ...props
}: PageShellProps) {
  const Tag = as as React.ElementType;

  return (
    <Tag
      className={cn(
        "mx-auto w-full",
        padded && "page-shell",
        WIDTH[width],
        GAP[gap],
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}
