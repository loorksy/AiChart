"use client";

import Image from "next/image";
import { useTheme } from "@/components/ThemeProvider";
import { cn } from "@/lib/utils";
import { BRAND_NAME } from "@/lib/brand";

type AiChartLogoProps = {
  className?: string;
  size?: number;
  showName?: boolean;
  nameClassName?: string;
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
}: AiChartLogoProps) {
  const { resolved } = useTheme();
  const src =
    resolved === "light"
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
        <span className={cn("font-semibold tracking-tight text-foreground", nameClassName)}>
          {BRAND_NAME}
        </span>
      ) : null}
    </span>
  );
}
