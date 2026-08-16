"use client";

import { useEffect, useRef } from "react";
import type { AnimationItem } from "lottie-web";
import { BRAND_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

const LOTTIE_PATH = "/brand/lonora-logo-loop.json";
/** Frame 0 is the complete owl-face lockup; the 8s loop returns here. */
const LOCKUP_FRAME = 0;

type LonoraLottieLogoProps = {
  className?: string;
  /** Accessible name. Decorative when the nearby heading already names the brand. */
  decorative?: boolean;
};

/**
 * Seamless Lonora logo sting authored in the unmodified diffusionstudio/lottie
 * Skottie player. Frame 0 and the last frame match so the finale can loop.
 */
export function LonoraLottieLogo({
  className,
  decorative = true,
}: LonoraLottieLogoProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let anim: AnimationItem | undefined;

    void (async () => {
      const lottie = (await import("lottie-web")).default;
      if (cancelled || !host) return;

      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      anim = lottie.loadAnimation({
        container: host,
        renderer: "svg",
        loop: !reduceMotion,
        autoplay: !reduceMotion,
        path: LOTTIE_PATH,
        rendererSettings: {
          preserveAspectRatio: "xMidYMid meet",
          progressiveLoad: true,
        },
      });

      if (reduceMotion) {
        anim.addEventListener("DOMLoaded", () => {
          anim?.goToAndStop(LOCKUP_FRAME, true);
        });
      }
    })();

    return () => {
      cancelled = true;
      anim?.destroy();
    };
  }, []);

  return (
    <div
      data-testid="lonora-lottie-logo"
      role={decorative ? "presentation" : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : BRAND_NAME}
      className={cn(
        "relative aspect-square w-full max-w-md overflow-hidden bg-black",
        className,
      )}
    >
      <div ref={hostRef} className="absolute inset-0" />
    </div>
  );
}
