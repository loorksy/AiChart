import type { Chart } from "klinecharts";
import { getChartForElement } from "@/lib/chart/klinechartsShim";

/** Resolve the klinecharts core instance mounted inside KLineChart Pro. */
export function findProWidgetChart(root: HTMLElement | null): Chart | null {
  if (!root) return null;
  const widget = root.querySelector(
    ".klinecharts-pro-widget",
  ) as HTMLElement | null;
  return getChartForElement(widget);
}

/** @deprecated use findProWidgetChart — kept for import compatibility. */
export function ensureKlineChartRegistry(): Promise<void> {
  return Promise.resolve();
}

export function getChartFromWidget(el: HTMLElement | null | undefined): Chart | null {
  return getChartForElement(el);
}
