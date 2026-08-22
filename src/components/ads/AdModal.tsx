"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Play, X } from "lucide-react";
import { Button } from "@/components/squareui/button";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

interface AdSlideView {
  text: string | null;
  image_url: string | null;
  animated: boolean;
}

interface ActiveAd {
  id: number;
  slides: AdSlideView[];
}

/** One ad per browser session, whatever else happens. */
const SESSION_KEY = "lonora-ad-shown";

/**
 * The ad modal. Rules it enforces, in order:
 *  - the REFUSAL modal always wins the screen: if one is up (or appears
 *    within the grace delay), the ad stays away for this session;
 *  - at most one ad per session; the X persists the dismissal per user
 *    server-side, so a closed ad never returns;
 *  - slide TEXT renders as text nodes — no HTML path exists;
 *  - images never break the layout (max-w/max-h contain them);
 *  - prefers-reduced-motion: an animated image (gif/webp) does not play
 *    unasked — a static cover with an explicit play button stands in.
 */
export function AdModal() {
  const { t, dir } = useLocale();
  const [ad, setAd] = useState<ActiveAd | null>(null);
  const [index, setIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [playAnimated, setPlayAnimated] = useState<Record<number, boolean>>({});
  const closedRef = useRef(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_KEY)) return;
    } catch {
      /* storage blocked → keep the session cap by simply not showing */
      return;
    }
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(media.matches);

    const timer = setTimeout(() => {
      // The refusal modal outranks any advertisement — never fight it.
      if (document.querySelector("[data-refusal-modal]")) return;
      fetch("/api/ads/active")
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { ad?: ActiveAd | null } | null) => {
          if (closedRef.current) return;
          if (document.querySelector("[data-refusal-modal]")) return;
          if (data?.ad && data.ad.slides.length > 0) {
            setAd(data.ad);
            try {
              sessionStorage.setItem(SESSION_KEY, "1");
            } catch {
              /* the server dismissal still applies */
            }
          }
        })
        .catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  if (!ad) return null;
  const slide = ad.slides[index]!;
  const many = ad.slides.length > 1;
  const holdAnimation = slide.animated && reducedMotion && !playAnimated[index];

  const close = () => {
    closedRef.current = true;
    setAd(null);
    // Persisted per user: this ad never comes back.
    void fetch("/api/ads/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ad_id: ad.id }),
    }).catch(() => {});
  };

  return (
    <div
      dir={dir}
      role="dialog"
      aria-modal="true"
      aria-label={t("ads.dialog_label")}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={close}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card elevation-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
          <span className="text-xs text-muted-foreground">{t("ads.label")}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("shell.close")}
            data-testid="ad-close"
            onClick={close}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>

        <div className="p-4">
          {slide.image_url ? (
            holdAnimation ? (
              <button
                type="button"
                className="flex h-40 w-full items-center justify-center gap-2 rounded-[var(--radius)] bg-muted text-sm text-muted-foreground"
                onClick={() => setPlayAnimated((p) => ({ ...p, [index]: true }))}
              >
                <Play className="size-4" aria-hidden="true" />
                {t("ads.play_animation")}
              </button>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={slide.image_url}
                alt=""
                className="mx-auto max-h-[50vh] w-auto max-w-full rounded-[var(--radius)] object-contain"
              />
            )
          ) : null}
          {slide.text ? (
            // TEXT nodes only — an admin string can never become markup here.
            <p className="mt-3 whitespace-pre-line text-sm text-foreground">{slide.text}</p>
          ) : null}
        </div>

        {many && (
          <div className="flex items-center justify-between border-t border-border/60 px-3 py-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("ads.prev")}
              disabled={index === 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
            >
              {dir === "rtl" ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
            </Button>
            <div className="flex items-center gap-1.5" aria-hidden="true">
              {ad.slides.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "size-1.5 rounded-full",
                    i === index ? "bg-foreground" : "bg-muted-foreground/40",
                  )}
                />
              ))}
            </div>
            <span className="sr-only">
              {t("ads.slide_position", {
                index: String(index + 1),
                count: String(ad.slides.length),
              })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("ads.next")}
              disabled={index === ad.slides.length - 1}
              onClick={() => setIndex((i) => Math.min(ad.slides.length - 1, i + 1))}
            >
              {dir === "rtl" ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
