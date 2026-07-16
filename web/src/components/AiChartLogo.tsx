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

/** Theme-aware AiChart mark — dark logo on light UI, light logo on dark UI. */
export function AiChartLogo({
  className,
  size = 20,
  showName = false,
  nameClassName,
}: AiChartLogoProps) {
  const { resolved } = useTheme();
  const src =
    resolved === "light" ? "/lonora-logo-light.png" : "/lonora-logo-dark.png";

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Image
        src={src}
        alt={BRAND_NAME}
        width={size}
        height={size}
        className="shrink-0 object-contain"
        priority
      />
      {showName ? (
        <span className={cn("font-semibold tracking-tight", nameClassName)}>
          {BRAND_NAME}
        </span>
      ) : null}
    </span>
  );
}
