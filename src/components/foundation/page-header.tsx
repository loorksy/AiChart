import * as React from "react";

import { cn } from "@/lib/utils";

export interface PageHeaderProps
  extends Omit<React.ComponentPropsWithRef<"header">, "title" | "children"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Small uppercase label above the title — section name, environment, tenant. */
  eyebrow?: React.ReactNode;
  /** Decorative only; it is hidden from assistive tech. */
  icon?: React.ReactNode;
  /** A <nav aria-label="…"> breadcrumb, rendered above everything else. */
  breadcrumb?: React.ReactNode;
  /** Buttons / filters. Wraps under the title on mobile, sits at the inline
   *  end from sm up. */
  actions?: React.ReactNode;
  /** Id placed on the heading so a region can point at it with
   *  aria-labelledby. */
  headingId?: string;
  headingLevel?: 1 | 2;
  border?: boolean;
  /** Pins the header while the page body scrolls. Opaque on purpose — a
   *  translucent bar over a candle chart is unreadable. */
  sticky?: boolean;
  children?: React.ReactNode;
}

/**
 * The top of a route. One per page; use SectionHeader for everything below it.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  icon,
  breadcrumb,
  actions,
  headingId,
  headingLevel = 1,
  border = false,
  sticky = false,
  className,
  children,
  ...props
}: PageHeaderProps) {
  const Heading = headingLevel === 1 ? "h1" : "h2";

  return (
    <header
      className={cn(
        "flex flex-col gap-3",
        border && "border-b border-border pb-4",
        sticky && "sticky top-0 z-header bg-background pt-1",
        className,
      )}
      {...props}
    >
      {breadcrumb}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="flex min-w-0 items-start gap-3">
          {icon ? (
            <span
              aria-hidden="true"
              className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[var(--radius)] border border-border bg-muted text-muted-foreground [&_svg]:size-[1.125rem]"
            >
              {icon}
            </span>
          ) : null}

          <div className="min-w-0">
            {eyebrow ? (
              <p className="type-overline mb-1 truncate">{eyebrow}</p>
            ) : null}

            <Heading id={headingId} className="type-title text-balance">
              {title}
            </Heading>

            {description ? (
              <p className="type-caption mt-1 max-w-[var(--container-reading)]">
                {description}
              </p>
            ) : null}
          </div>
        </div>

        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
            {actions}
          </div>
        ) : null}
      </div>

      {children}
    </header>
  );
}
