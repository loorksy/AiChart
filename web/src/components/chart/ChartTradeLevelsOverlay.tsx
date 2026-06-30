"use client";

import { useEffect, useMemo, useState } from "react";
import { ActionType, type Chart, type KLineData } from "klinecharts";
import { formatLevel } from "@/components/market/formatLevel";
import type { Recommendation } from "@/lib/types";

export interface TradeLevelLine {
  price: number;
  label: string;
  color: string;
}

export function tradeLevelsFromRecommendation(
  rec: Recommendation,
  targets: number[],
): TradeLevelLine[] {
  const lines: TradeLevelLine[] = [];
  if (rec.entry != null && rec.entry > 0) {
    lines.push({ price: rec.entry, label: "دخول", color: "#22c55e" });
  }
  if (rec.stop_loss != null && rec.stop_loss > 0) {
    lines.push({ price: rec.stop_loss, label: "وقف خسارة", color: "#ef4444" });
  }
  const tps =
    targets.length > 0
      ? targets.filter((t) => t > 0)
      : rec.take_profit != null && rec.take_profit > 0
        ? [rec.take_profit]
        : [];
  tps.forEach((price, i) => {
    lines.push({
      price,
      label: tps.length > 1 ? `هدف ${i + 1}` : "هدف ربح",
      color: "#3b82f6",
    });
  });
  return lines;
}

function priceBounds(candles: KLineData[], lines: TradeLevelLine[]) {
  const prices = [
    ...candles.map((c) => c.high),
    ...candles.map((c) => c.low),
    ...lines.map((l) => l.price),
  ].filter((p) => Number.isFinite(p) && p > 0);
  if (prices.length === 0) return { min: 0, max: 1 };
  let min = Math.min(...prices);
  let max = Math.max(...prices);
  const pad = Math.max((max - min) * 0.08, max * 0.0002);
  return { min: min - pad, max: max + pad };
}

function priceToTopPct(price: number, min: number, max: number): number {
  if (max <= min) return 50;
  const ratio = (max - price) / (max - min);
  return Math.min(100, Math.max(0, ratio * 100));
}

interface PlacedLine extends TradeLevelLine {
  key: string;
  topPx: number;
}

/** HTML fallback lines above the chart canvas (sibling layer, not inside widget DOM). */
export function ChartTradeLevelsOverlay({
  chart,
  widgetEl,
  mountEl,
  recommendation,
  targets = [],
  candles = [],
}: {
  chart?: Chart | null;
  widgetEl?: HTMLElement | null;
  mountEl?: HTMLElement | null;
  recommendation?: Recommendation | null;
  targets?: number[];
  candles?: KLineData[];
}) {
  const hasTrade =
    recommendation &&
    (recommendation.action === "buy" || recommendation.action === "sell");

  const levelLines = useMemo(() => {
    if (!hasTrade || !recommendation) return [];
    return tradeLevelsFromRecommendation(recommendation, targets);
  }, [hasTrade, recommendation, targets]);

  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [placed, setPlaced] = useState<PlacedLine[]>([]);

  useEffect(() => {
    if (!mountEl || levelLines.length === 0) {
      setBox(null);
      setPlaced([]);
      return;
    }

    const lastTs = candles[candles.length - 1]?.timestamp;

    const update = () => {
      if (!mountEl) return;

      let area = { top: 38, left: 52, width: mountEl.clientWidth - 52, height: mountEl.clientHeight * 0.74 };
      if (widgetEl) {
        const mr = mountEl.getBoundingClientRect();
        const wr = widgetEl.getBoundingClientRect();
        area = {
          top: wr.top - mr.top,
          left: wr.left - mr.left,
          width: wr.width,
          height: wr.height * 0.74,
        };
      }
      setBox(area);

      if (chart && lastTs) {
        try {
          const next: PlacedLine[] = [];
          for (const line of levelLines) {
            const coord = chart.convertToPixel(
              { timestamp: lastTs, value: line.price },
              { absolute: true },
            ) as { y?: number };
            if (typeof coord?.y !== "number" || !Number.isFinite(coord.y)) continue;
            next.push({
              ...line,
              key: `${line.label}-${line.price}`,
              topPx: area.top + coord.y,
            });
          }
          if (next.length > 0) {
            setPlaced(next);
            return;
          }
        } catch {
          /* percent fallback */
        }
      }

      const bounds = priceBounds(candles, levelLines);
      setPlaced(
        levelLines.map((line) => ({
          ...line,
          key: `${line.label}-${line.price}`,
          topPx:
            area.top +
            (priceToTopPct(line.price, bounds.min, bounds.max) / 100) * area.height,
        })),
      );
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(mountEl);
    if (widgetEl) ro.observe(widgetEl);

    if (chart) {
      const onViewChange = () => update();
      chart.subscribeAction(ActionType.OnZoom, onViewChange);
      chart.subscribeAction(ActionType.OnScroll, onViewChange);
      chart.subscribeAction(ActionType.OnVisibleRangeChange, onViewChange);
      const poll = window.setInterval(update, 500);
      return () => {
        ro.disconnect();
        clearInterval(poll);
        chart.unsubscribeAction(ActionType.OnZoom, onViewChange);
        chart.unsubscribeAction(ActionType.OnScroll, onViewChange);
        chart.unsubscribeAction(ActionType.OnVisibleRangeChange, onViewChange);
      };
    }

    const poll = window.setInterval(update, 400);
    return () => {
      ro.disconnect();
      clearInterval(poll);
    };
  }, [chart, widgetEl, mountEl, candles, levelLines]);

  if (!hasTrade || !mountEl || !box || placed.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[30] overflow-hidden"
      aria-hidden
    >
      {placed.map((line) => (
        <div
          key={line.key}
          className="absolute"
          style={{
            top: line.topPx,
            left: box.left,
            width: box.width,
            transform: "translateY(-50%)",
          }}
        >
          <div
            className="w-full border-t-2"
            style={{ borderColor: line.color }}
          />
          <span
            className="absolute start-1 -top-3 rounded px-1 py-px text-[10px] font-semibold leading-none shadow-sm"
            style={{
              color: line.color,
              backgroundColor: "rgba(21,21,23,0.88)",
            }}
          >
            {line.label}{" "}
            <span dir="ltr">{formatLevel(line.price)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
