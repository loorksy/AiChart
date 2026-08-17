"use client";

import { useEffect, useState } from "react";
import {
  MetalFx as MetalFxPrimitive,
  type MetalFxProps,
  type MetalFxPreset,
  type MetalFxTheme,
  type MetalFxVariant,
} from "metal-fx";
import { useTheme } from "@/components/ThemeProvider";

export type { MetalFxProps, MetalFxPreset, MetalFxTheme, MetalFxVariant };

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}

/**
 * App-themed MetalFx: follows Lonora's `.dark` class, not the OS scheme,
 * and freezes the ring when the operator asked for reduced motion.
 */
export function MetalFx({
  theme,
  paused,
  ...props
}: MetalFxProps) {
  const { resolved } = useTheme();
  const reduceMotion = usePrefersReducedMotion();
  return (
    <MetalFxPrimitive
      theme={theme ?? resolved}
      paused={paused ?? reduceMotion}
      {...props}
    />
  );
}
