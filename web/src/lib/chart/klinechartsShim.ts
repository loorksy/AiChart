// @ts-nocheck
"use client";

/**
 * Wraps klinecharts.init so KLineChart Pro and AiChart share one module instance
 * and we can resolve the Chart mounted on `.klinecharts-pro-widget`.
 */
// Real package ESM — bypasses the klinecharts→shim alias (see next.config.ts).
import * as KlineCharts from "../../../node_modules/klinecharts/dist/index.esm.js";

export * from "../../../node_modules/klinecharts/dist/index.esm.js";

type ChartInstance = NonNullable<ReturnType<typeof KlineCharts.init>>;

const chartByContainer = new WeakMap<HTMLElement, ChartInstance>();

const originalInit = KlineCharts.init;

export function init(
  ds: Parameters<typeof KlineCharts.init>[0],
  options?: Parameters<typeof KlineCharts.init>[1],
): ReturnType<typeof KlineCharts.init> {
  const chart = originalInit(ds, options);
  if (chart) {
    const el = typeof ds === "string" ? document.getElementById(ds) : ds;
    if (el) chartByContainer.set(el, chart);
  }
  return chart;
}

export function getChartForElement(
  el: HTMLElement | null | undefined,
): ChartInstance | null {
  if (!el) return null;
  return chartByContainer.get(el) ?? null;
}
