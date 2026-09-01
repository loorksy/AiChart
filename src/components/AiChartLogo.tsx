"use client";

import Image from "next/image";
import { useTheme } from "@/components/ThemeProvider";
import { cn } from "@/lib/utils";
import { BRAND_NAME, BRAND_WORDMARK } from "@/lib/brand";

type AiChartLogoProps = {
  className?: string;
  size?: number;
  showName?: boolean;
  nameClassName?: string;
  /** Overlay menus sit on a forced dark field regardless of the page theme. */
  forceScheme?: "light" | "dark";
};

/**
 * Theme-aware AiChart face mark.
 * Uses object-contain and no overflow clipping so the full mark stays visible.
 */
export function AiChartLogo({
  className,
  size = 28,
  showName = false,
  nameClassName,
  forceScheme,
}: AiChartLogoProps) {
  const { resolved } = useTheme();
  const scheme = forceScheme ?? resolved;
  const src =
    scheme === "light"
      ? "/brand/aichart-mark-light.svg"
      : "/brand/aichart-mark.svg";

  return (
    <span
      className={cn("inline-flex max-w-full items-center gap-2 overflow-visible", className)}
      data-testid="aichart-logo"
    >
      <span
        className="relative inline-flex shrink-0 items-center justify-center overflow-visible"
        style={{ width: size, height: size }}
      >
        <Image
          src={src}
          alt={showName ? "" : BRAND_NAME}
          width={size}
          height={size}
          className="object-contain"
          style={{ width: size, height: size, maxWidth: "100%" }}
          priority
          unoptimized
        />
      </span>
      {showName ? (
        <span
          data-testid="aichart-wordmark"
          className={cn("font-semibold uppercase tracking-[0.14em] text-foreground", nameClassName)}
        >
          {BRAND_WORDMARK}
        </span>
      ) : null}
    </span>
  );
}
