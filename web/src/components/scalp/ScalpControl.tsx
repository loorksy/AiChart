"use client";

import { useEffect, useState } from "react";
import { Activity, Play, Square } from "lucide-react";
import { SurfaceCard } from "@/components/ui/shell";

interface ScalpSessionView {
  active: number;
  symbol: string;
  market: string;
  interval: string;
  max_trades: number;
  executed_count: number;
}

interface ScalpStatus {
  session: ScalpSessionView | null;
  mode: "paper" | "live";
}

/** User-facing start/stop control for the scalp loop (calls /api/scalp). */
export function ScalpControl() {
  const [status, setStatus] = useState<ScalpStatus | null>(null);
  const [symbol, setSymbol] = useState("");
  const [maxTrades, setMaxTrades] = useState(5);
  const [market, setMarket] = useState<"crypto" | "forex">("crypto");
  const [interval, setIntervalTf] = useState("1m");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null,
  );

  async function refresh() {
    try {
      const r = await fetch("/api/scalp", { cache: "no-store" });
      if (r.ok) setStatus(await r.json());
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  // Poll while running so executed_count stays fresh.
  useEffect(() => {
    if (!status?.session?.active) return;
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [status?.session?.active]);

  async function start() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/scalp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          symbol: symbol.trim().toUpperCase(),
          market,
          interval,
          max_trades: maxTrades,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg({ type: "err", text: d.error ?? "تعذّر بدء الجلسة." });
      } else {
        setMsg({ type: "ok", text: `بدأت جلسة سكالب على ${d.symbol}` });
        await refresh();
      }
    } catch {
      setMsg({ type: "err", text: "خطأ في الاتصال." });
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    setMsg(null);
    try {
      await fetch("/api/scalp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      setMsg({ type: "ok", text: "أوقفت الجلسة." });
      await refresh();
    } catch {
      setMsg({ type: "err", text: "خطأ في الاتصال." });
    } finally {
      setBusy(false);
    }
  }

  const active = Boolean(status?.session?.active);
  const session = status?.session;

  return (
    <SurfaceCard>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold">
          <Activity className="h-4 w-4" />
          وضع السكالب
        </h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            status?.mode === "live"
              ? "bg-red-500/15 text-red-500"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {status?.mode === "live" ? "تنفيذ حقيقي" : "تجريبي (paper)"}
        </span>
      </div>

      {active && session ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm">
            تعمل الآن على{" "}
            <span className="font-semibold">{session.symbol}</span> ·{" "}
            {session.interval} · {session.market}
          </p>
          <p className="text-sm text-muted-foreground">
            الصفقات المنفّذة: {session.executed_count} / {session.max_trades}
          </p>
          <button
            onClick={() => void stop()}
            disabled={busy}
            className="btn btn-danger mt-1 flex items-center gap-2 text-sm"
          >
            <Square className="h-4 w-4" />
            إيقاف السكالب
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted-foreground">
            حلقة آلية تفتح وتغلق صفقات سريعة لرمز واحد حتى بلوغ سقف الصفقات.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              الرمز
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="BTCUSDT"
                className="input mt-1 w-full"
              />
            </label>
            <label className="text-sm">
              سقف الصفقات
              <input
                type="number"
                min={1}
                max={100}
                value={maxTrades}
                onChange={(e) => setMaxTrades(Number(e.target.value))}
                className="input mt-1 w-full"
              />
            </label>
            <label className="text-sm">
              السوق
              <select
                value={market}
                onChange={(e) =>
                  setMarket(e.target.value as "crypto" | "forex")
                }
                className="input mt-1 w-full"
              >
                <option value="crypto">كريبتو</option>
                <option value="forex">فوركس</option>
              </select>
            </label>
            <label className="text-sm">
              الإطار
              <select
                value={interval}
                onChange={(e) => setIntervalTf(e.target.value)}
                className="input mt-1 w-full"
              >
                <option value="1m">1m</option>
                <option value="3m">3m</option>
                <option value="5m">5m</option>
                <option value="15m">15m</option>
              </select>
            </label>
          </div>
          <button
            onClick={() => void start()}
            disabled={busy || !symbol.trim()}
            className="btn btn-primary flex items-center gap-2 text-sm"
          >
            <Play className="h-4 w-4" />
            تشغيل السكالب
          </button>
        </div>
      )}

      {msg && (
        <p
          className={`mt-3 text-sm ${
            msg.type === "ok" ? "text-emerald-500" : "text-red-500"
          }`}
        >
          {msg.text}
        </p>
      )}
    </SurfaceCard>
  );
}
