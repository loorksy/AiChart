"use client";

import { useEffect, useRef, useState } from "react";
import { intervalPlan } from "@/lib/intervals";
import { toChartSeconds } from "@/lib/ohlc/chartTime";

export interface KlineBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  closed: boolean;
}

const WS_BASE = "wss://stream.binance.com:9443/ws";

/**
 * Binance kline WebSocket — updates the active candle at bar boundaries
 * (more accurate than patching close from aggTrade on every tick).
 * Only connects for native Binance intervals (factor === 1).
 */
export function useBinanceKlineStream(
  symbol: string,
  interval: string,
  enabled = true,
): KlineBar | null {
  const [bar, setBar] = useState<KlineBar | null>(null);
  const key = `${symbol.toUpperCase()}|${interval}`;

  useEffect(() => {
    if (!enabled || !symbol) {
      setBar(null);
      return;
    }

    const { base, factor } = intervalPlan(interval);
    if (factor !== 1) {
      setBar(null);
      return;
    }

    let alive = true;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      if (!alive) return;
      const stream = `${symbol.toLowerCase()}@kline_${base}`;
      ws = new WebSocket(`${WS_BASE}/${stream}`);

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as {
            k?: {
              t: number;
              o: string;
              h: string;
              l: string;
              c: string;
              x: boolean;
            };
          };
          const k = msg.k;
          if (!k) return;
          setBar({
            time: toChartSeconds(k.t),
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            closed: Boolean(k.x),
          });
        } catch {
          /* ignore malformed frames */
        }
      };

      ws.onclose = () => {
        if (alive) reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => ws?.close();
    }

    connect();

    return () => {
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [key, enabled]);

  return bar;
}

/** Throttle high-frequency price patches to ~10fps for derived intervals. */
export function useThrottledLivePrice(
  livePrice: number | undefined,
  ms = 100,
): number | undefined {
  const [throttled, setThrottled] = useState(livePrice);
  const pendingRef = useRef<number | undefined>(livePrice);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    pendingRef.current = livePrice;
    if (livePrice == null || livePrice <= 0) {
      setThrottled(livePrice);
      return;
    }
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setThrottled(pendingRef.current);
    }, ms);
  }, [livePrice, ms]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return throttled;
}
