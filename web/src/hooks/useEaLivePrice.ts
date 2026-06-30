"use client";

import { useEffect, useRef, useState } from "react";
import type { LivePriceTick } from "./useBinanceLivePrice";

const POLL_MS = 1000;

/**
 * Live forex price polled from OANDA via `/api/market/forex-price`.
 */
export function useEaLivePrice(symbol: string, enabled = true): LivePriceTick {
  const [tick, setTick] = useState<LivePriceTick>({
    price: 0,
    changePct: 0,
    direction: null,
    connected: false,
  });
  const prevRef = useRef(0);

  useEffect(() => {
    // When disabled (e.g. crypto market active) we simply stop polling; the
    // consumer reads the other market's tick, so a stale value is harmless.
    if (!enabled || !symbol) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/market/forex-price?symbol=${encodeURIComponent(symbol)}`,
        );
        const data = (await res.json()) as {
          online?: boolean;
          price?: number | null;
        };
        if (!alive) return;
        const price = Number(data.price) || 0;
        const prev = prevRef.current || price;
        const direction = price > prev ? "up" : price < prev ? "down" : null;
        prevRef.current = price;
        setTick({
          price,
          changePct: 0,
          direction,
          connected: Boolean(data.online),
        });
      } catch {
        /* keep last tick */
      } finally {
        if (alive) timer = setTimeout(poll, POLL_MS);
      }
    };
    void poll();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [symbol, enabled]);

  return tick;
}
