import * as React from "react";

import { cn } from "@/lib/utils";

export interface SectionHeaderProps
  extends Omit<React.ComponentPropsWithRef<"div">, "title" | "children"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Sits beside the title — a count badge, a live status, a timestamp. */
  meta?: React.ReactNode;
  /** Controls for this section only. */
  actions?: React.ReactNode;
  /** Decorative only; hidden from assistive tech. */
  icon?: React.ReactNode;
  headingLevel?: 2 | 3 | 4;
  /** Id for the heading so the surrounding region can use aria-labelledby. */
  headingId?: string;
  border?: boolean;
  children?: React.ReactNode;
}

/**
 * Heading for a block inside a page. Keeps the heading order honest: pass
 * headingLevel so a section nested under an h2 emits an h3 rather than
 * another h2.
 */
export function SectionHeader({
  title,
  description,
  meta,
  actions,
  icon,
  headingLevel = 2,
  headingId,
  border = false,
  className,
  children,
  ...props
}: SectionHeaderProps) {
  const Heading: "h2" | "h3" | "h4" = `h${headingLevel}`;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4",
        border && "border-b border-border pb-3",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {icon ? (
          <span
            aria-hidden="true"
            className="mt-px shrink-0 text-muted-foreground [&_svg]:size-4"
          >
            {icon}
          </span>
        ) : null}

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Heading id={headingId} className="type-heading">
              {title}
            </Heading>
            {meta}
          </div>

          {description ? (
            <p className="type-caption mt-0.5 max-w-[var(--container-reading)]">
              {description}
            </p>
          ) : null}
        </div>
      </div>

      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}

      {children}
    </div>
  );
}
