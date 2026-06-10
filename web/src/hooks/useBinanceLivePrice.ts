"use client";

import { useEffect, useRef, useState } from "react";

export type PriceDirection = "up" | "down" | null;

export interface LivePriceTick {
  price: number;
  changePct: number;
  direction: PriceDirection;
  connected: boolean;
}

const WS_BASE = "wss://stream.binance.com:9443/stream";

function buildStreamUrl(symbols: string[]): string {
  const streams = symbols.flatMap((s) => {
    const sym = s.toLowerCase();
    return [`${sym}@aggTrade`, `${sym}@miniTicker`];
  });
  return `${WS_BASE}?streams=${streams.join("/")}`;
}

/**
 * Real-time Binance price via WebSocket (aggTrade = per-trade, miniTicker = 24h %).
 * Use for single symbol or pass one-item array.
 */
export function useBinanceLivePrice(symbol: string): LivePriceTick {
  const map = useBinanceLivePrices(symbol ? [symbol] : []);
  return (
    map[symbol.toUpperCase()] ?? {
      price: 0,
      changePct: 0,
      direction: null,
      connected: false,
    }
  );
}

export type LivePriceMap = Record<
  string,
  { price: number; changePct: number; direction: PriceDirection; connected: boolean }
>;

/**
 * Subscribe to live prices for multiple USDT pairs (combined Binance stream).
 */
export function useBinanceLivePrices(symbols: string[]): LivePriceMap {
  const [ticks, setTicks] = useState<LivePriceMap>({});
  const prevPrices = useRef<Record<string, number>>({});
  const changePctRef = useRef<Record<string, number>>({});
  const connectedRef = useRef(false);

  const key = symbols
    .map((s) => s.toUpperCase())
    .sort()
    .join(",");

  useEffect(() => {
    if (!symbols.length) {
      setTicks({});
      return;
    }

    const upper = symbols.map((s) => s.toUpperCase());
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(
          `/api/market/tickers?symbols=${encodeURIComponent(upper.join(","))}`,
        );
        const data = (await res.json()) as Record<
          string,
          { price: number; changePct: number }
        >;
        if (cancelled || !res.ok) return;

        setTicks((prev) => {
          const next = { ...prev };
          for (const sym of upper) {
            const row = data[sym];
            if (!row?.price) continue;
            prevPrices.current[sym] = row.price;
            changePctRef.current[sym] = row.changePct;
            next[sym] = {
              price: row.price,
              changePct: row.changePct,
              direction: prev[sym]?.direction ?? null,
              connected: prev[sym]?.connected ?? false,
            };
          }
          return next;
        });
      } catch {
        /* REST bootstrap optional */
      }
    })();

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;

    const setConnected = (v: boolean) => {
      connectedRef.current = v;
      setTicks((prev) => {
        const next = { ...prev };
        for (const sym of upper) {
          next[sym] = {
            price: next[sym]?.price ?? 0,
            changePct: next[sym]?.changePct ?? changePctRef.current[sym] ?? 0,
            direction: next[sym]?.direction ?? null,
            connected: v,
          };
        }
        return next;
      });
    };

    function connect() {
      if (!alive) return;
      ws = new WebSocket(buildStreamUrl(upper));

      ws.onopen = () => setConnected(true);

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as { data?: Record<string, unknown> };
          const data = msg.data;
          if (!data || typeof data.s !== "string") return;

          const sym = (data.s as string).toUpperCase();

          if (data.e === "aggTrade" && typeof data.p === "string") {
            const price = parseFloat(data.p);
            const prev = prevPrices.current[sym] ?? price;
            prevPrices.current[sym] = price;
            const direction: PriceDirection =
              price > prev ? "up" : price < prev ? "down" : null;

            setTicks((t) => ({
              ...t,
              [sym]: {
                price,
                changePct: changePctRef.current[sym] ?? t[sym]?.changePct ?? 0,
                direction,
                connected: true,
              },
            }));
          } else if (data.e === "24hrMiniTicker") {
            const price =
              typeof data.c === "string" ? parseFloat(data.c) : prevPrices.current[sym] ?? 0;
            const changePct =
              typeof data.P === "string" ? parseFloat(data.P) : changePctRef.current[sym] ?? 0;
            changePctRef.current[sym] = changePct;
            if (!prevPrices.current[sym]) prevPrices.current[sym] = price;

            setTicks((t) => ({
              ...t,
              [sym]: {
                price: prevPrices.current[sym] || price,
                changePct,
                direction: t[sym]?.direction ?? null,
                connected: true,
              },
            }));
          }
        } catch {
          /* ignore malformed frames */
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (alive) reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => ws?.close();
    }

    connect();

    return () => {
      cancelled = true;
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [key]);

  return ticks;
}
