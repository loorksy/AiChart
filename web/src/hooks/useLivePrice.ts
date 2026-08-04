"use client";

import { useEffect, useRef, useState } from "react";
import type { LivePriceTick } from "@/hooks/livePriceTypes";

const POLL_MS = 1000;

/**
 * Live forex price polled from OANDA via `/api/market/forex-price`.
 */
export function useLivePrice(symbol: string, enabled = true): LivePriceTick {
  const [tick, setTick] = useState<LivePriceTick>({
    price: 0,
    changePct: 0,
    direction: null,
    connected: false,
  });
  const prevRef = useRef(0);

  useEffect(() => {
    // When disabled we simply stop polling.
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
          bid?: number | null;
          ask?: number | null;
          spread_label?: string | null;
          spread_pips?: number | null;
          source?: "oanda" | "metaapi" | null;
        };
        if (!alive) return;
        const price = Number(data.price) || 0;
        const bid = Number(data.bid);
        const ask = Number(data.ask);
        const prev = prevRef.current || price;
        const direction = price > prev ? "up" : price < prev ? "down" : null;
        prevRef.current = price;
        setTick({
          price,
          changePct: 0,
          direction,
          connected: Boolean(data.online),
          bid: Number.isFinite(bid) && bid > 0 ? bid : null,
          ask: Number.isFinite(ask) && ask > 0 ? ask : null,
          spreadLabel: data.spread_label ?? null,
          spreadPips: data.spread_pips ?? null,
          source: data.source ?? null,
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
