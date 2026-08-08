"use client";

import { useEffect } from "react";

/**
 * On mount, scroll once to the element matching `window.location.hash`
 * (e.g. `/performance#trades`). Section ids are owned by RecommendationsSection,
 * TradesClient, StatisticsSection, and BacktestSection.
 */
export function PerformanceHashScroll() {
  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, "").trim();
    if (!raw) return;
    const el = document.getElementById(raw);
    if (!el) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
  }, []);

  return null;
}
