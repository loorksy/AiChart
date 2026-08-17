"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { MetalFx } from "@/components/ui/metal-fx";
import { cn } from "@/lib/utils";

/**
 * Circular metal icon control — the icon-mode counterpart of the liquid
 * metal text button. Shares one WebGL renderer across every instance.
 */
export function MetalIconButton({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <MetalFx
      preset="chromatic"
      variant="circle"
      strength={1}
      className="shrink-0"
    >
      <button
        type="button"
        className={cn("metal-icon-face", className)}
        {...props}
      >
        {children}
      </button>
    </MetalFx>
  );
}
