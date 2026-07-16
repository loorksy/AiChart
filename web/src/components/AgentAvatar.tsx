"use client";

import Image from "next/image";
import { useTheme } from "@/components/ThemeProvider";
import { cn } from "@/lib/utils";
import { BRAND_NAME } from "@/lib/brand";

type AgentAvatarProps = {
  className?: string;
  size?: number;
  /** Decorative (default) — hide from AT when paired with visible text. */
  decorative?: boolean;
};

/** Small theme-aware agent face mark for chat, voice, and empty states. */
export function AgentAvatar({
  className,
  size = 28,
  decorative = true,
}: AgentAvatarProps) {
  const { resolved } = useTheme();
  const src =
    resolved === "light"
      ? "/brand/aichart-avatar-light-64.png"
      : "/brand/aichart-avatar-64.png";

  return (
    <Image
      src={src}
      alt={decorative ? "" : BRAND_NAME}
      width={size}
      height={size}
      className={cn("shrink-0 object-contain", className)}
      aria-hidden={decorative ? true : undefined}
      priority={false}
    />
  );
}
