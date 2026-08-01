import * as React from "react";

import { cn } from "@/lib/utils";

export type StatusTone = "ok" | "warn" | "error" | "info" | "neutral";

const TONE: Record<StatusTone, string> = {
  ok: "status-dot-ok",
  warn: "status-dot-warn",
  error: "status-dot-error",
  info: "status-dot-info",
  neutral: "status-dot-neutral",
};

export interface StatusDotProps
  extends Omit<React.ComponentPropsWithRef<"span">, "children"> {
  status: StatusTone;
  /** Accessible name. Without it the dot is decorative and hidden — colour
   *  alone is never the only carrier of meaning, so pass a label whenever the
   *  dot is not accompanied by visible text. */
  label?: string;
  pulse?: boolean;
}

export function StatusDot({
  status,
  label,
  pulse = true,
  className,
  ...props
}: StatusDotProps) {
  return (
    <span
      className={cn("status-dot", TONE[status], className)}
      data-pulse={pulse ? "true" : "false"}
      data-status={status}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...props}
    />
  );
}
