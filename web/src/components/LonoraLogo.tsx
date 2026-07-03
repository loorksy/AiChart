"use client";

import Image from "next/image";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { BRAND_NAME } from "@/lib/brand";

type LonoraLogoProps = {
  className?: string;
  size?: number;
  showName?: boolean;
  nameClassName?: string;
};

/** Theme-aware Lonora mark — dark logo on light UI, light logo on dark UI. */
export function LonoraLogo({
  className,
  size = 20,
  showName = false,
  nameClassName,
}: LonoraLogoProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const src =
    mounted && resolvedTheme === "light"
      ? "/lonora-logo-light.png"
      : "/lonora-logo-dark.png";

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
