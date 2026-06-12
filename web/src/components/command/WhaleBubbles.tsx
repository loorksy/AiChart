"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

interface FlowSignal {
  symbol?: string;
  side?: string;
  amountUsd?: number;
  notional?: number;
  ts?: number;
}

function normalizeSignals(raw: unknown): FlowSignal[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as FlowSignal[];
  const obj = raw as { data?: FlowSignal[]; list?: FlowSignal[] };
  return obj.data ?? obj.list ?? [];
}

export function WhaleBubbles({ signalsRaw }: { signalsRaw: unknown }) {
  const [bubbles, setBubbles] = useState<
    { id: number; symbol: string; side: string; size: number; born: number }[]
  >([]);
  const [tick, setTick] = useState(0);

  const incoming = useMemo(() => normalizeSignals(signalsRaw), [signalsRaw]);

  useEffect(() => {
    if (!incoming.length) return;
    const top = incoming.slice(0, 8);
    setBubbles((prev) => {
      const next = [...prev];
      for (const s of top) {
        const notional = Number(s.amountUsd ?? s.notional ?? 10000);
        next.push({
          id: Date.now() + Math.random(),
          symbol: String(s.symbol ?? "???").slice(0, 8),
          side: String(s.side ?? "buy"),
          size: Math.min(120, Math.max(24, Math.sqrt(notional) / 8)),
          born: Date.now(),
        });
      }
      return next.slice(-24);
    });
  }, [incoming]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setBubbles((b) => b.filter((x) => now - x.born < 8000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  void tick;

  return (
    <div className="relative h-48 overflow-hidden rounded-xl border border-border/60 bg-secondary/20">
      {bubbles.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          بانتظار إشارات smart money…
        </p>
      )}
      {bubbles.map((b, i) => {
        const age = (Date.now() - b.born) / 8000;
        const opacity = Math.max(0, 1 - age);
        return (
          <span
            key={b.id}
            className={cn(
              "absolute flex items-center justify-center rounded-full text-[9px] font-semibold text-white shadow-md transition-opacity",
              b.side.toLowerCase().includes("sell")
                ? "bg-red-500/80"
                : "bg-green-500/80",
            )}
            style={{
              width: b.size,
              height: b.size,
              left: `${(i * 37 + 10) % 85}%`,
              top: `${(i * 23 + 15) % 70}%`,
              opacity,
            }}
            dir="ltr"
          >
            {b.symbol}
          </span>
        );
      })}
    </div>
  );
}
