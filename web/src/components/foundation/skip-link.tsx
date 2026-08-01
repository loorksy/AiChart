import * as React from "react";

import { cn } from "@/lib/utils";

export interface SkipLinkProps {
  /** Id of the element to jump to. That element needs tabIndex={-1} so the
   *  jump actually moves focus and not just the scroll position. */
  targetId: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * First focusable element on the page. Off-screen until it takes focus.
 */
export function SkipLink({ targetId, children, className }: SkipLinkProps) {
  return (
    <a href={`#${targetId}`} className={cn("skip-link", className)}>
      {children}
    </a>
  );
}
