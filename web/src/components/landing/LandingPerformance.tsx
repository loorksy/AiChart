"use client";

import { useEffect, useState } from "react";
import { Activity, ShieldCheck, TrendingUp, Cpu, Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocale } from "@/components/LocaleProvider";

interface LogEntry {
  id: string;
  time: string;
  platform: "Binance" | "MT5";
  type: string;
  symbol: string;
  detail: string;
  status: "success" | "pending" | "info";
}

export function LandingPerformance() {
  const { locale } = useLocale();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeAgents, setActiveAgents] = useState(148);
  const [totalExecutions, setTotalExecutions] = useState(12480);
  const [livePnL, setLivePnL] = useState(3.42);

  // Generate simulated logs in real time
  useEffect(() => {
    const initialLogs: LogEntry[] = [
      {
        id: "1",
        time: "03:45:10",
        platform: "Binance",
        type: "BUY",
        symbol: "BTCUSDT",
        detail: "ستوب لوز: $63,800 · تيك بروفيت: $66,200",
        status: "success",
      },
      {
        id: "2",
        time: "03:46:12",
        platform: "MT5",
        type: "BUY",
        symbol: "EURUSD",
        detail: "ستوب لوز: 1.07900 · تيك بروفيت: 1.08900",
        status: "success",
      },
      {
        id: "3",
        time: "03:47:55",
        platform: "Binance",
        type: "TP TARGET",
        symbol: "ETHUSDT",
        detail: "تيك بروفيت منفّذ تلقائياً (+2.85%)",
        status: "info",
      },
    ];
    setLogs(initialLogs);

    const logPool = [
      { platform: "Binance", type: "BUY", symbol: "SOLUSDT", detail: "ستوب لوز: $132.50 · تيك بروفيت: $148.00" },
      { platform: "MT5", type: "SELL", symbol: "GBPUSD", detail: "ستوب لوز: 1.27500 · تيك بروفيت: 1.25800" },
      { platform: "Binance", type: "BUY", symbol: "BNBUSDT", detail: "ستوب لوز: $582.00 · تيك بروفيت: $615.00" },
      { platform: "MT5", type: "TP TARGET", symbol: "XAUUSD", detail: "تيك بروفيت منفّذ على الذهب (+3.20%)" },
      { platform: "Binance", type: "SL HIT", symbol: "AVAXUSDT", detail: "ستوب لوز مفعّل لحماية رأس المال (-1.5%)" },
    ] as const;

    const interval = setInterval(() => {
      // Rotate metrics slightly
      setActiveAgents((prev) => prev + (Math.random() > 0.5 ? 1 : -1));
      setTotalExecutions((prev) => prev + 1);
      setLivePnL((prev) => prev + (Math.random() > 0.45 ? 0.05 : -0.03));

      // Append new log entry
      const randomSeed = logPool[Math.floor(Math.random() * logPool.length)];
      const now = new Date();
      const timeStr = now.toTimeString().split(" ")[0];
      const newLog: LogEntry = {
        id: String(Date.now()),
        time: timeStr,
        platform: randomSeed.platform,
        type: randomSeed.type,
        symbol: randomSeed.symbol,
        detail: locale === "ar" ? randomSeed.detail : randomSeed.detail
          .replace("ستوب لوز", "SL")
          .replace("تيك بروفيت", "TP")
          .replace("منفّذ تلقائياً", "Auto Executed")
          .replace("منفّذ على الذهب", "Executed on Gold")
          .replace("مفعّل لحماية رأس المال", "Triggered to protect capital"),
        status: randomSeed.type.includes("TP") ? "info" : randomSeed.type.includes("SL") ? "pending" : "success",
      };

      setLogs((prev) => [newLog, ...prev.slice(0, 5)]);
    }, 4500);

    return () => clearInterval(interval);
  }, [locale]);

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <div className="grid gap-10 lg:grid-cols-5 items-center">
        
        {/* Metric Cards - 2 Columns on desktop */}
        <div className="lg:col-span-2 space-y-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Activity className="h-3.5 w-3.5" />
              <span>{locale === "ar" ? "بث الأداء المباشر" : "Live Performance Stream"}</span>
            </div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {locale === "ar" ? "تشغيل عبر المنصات بالثواني" : "Cross-Platform Execution Live"}
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {locale === "ar"
                ? "شاهد وكلاء الذكاء الاصطناعي يراقبون مستويات الأسعار، ويفحصون إعدادات المخاطر (Risk Guard) وينفذون الصفقات بشكل متزامن على Binance و MT5."
                : "Watch AI Agents monitor price action levels, verify Risk Guard constraints, and execute trades concurrently across Binance and MetaTrader 5."}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            
            {/* Card 1: Active Agents */}
            <div className="rounded-xl border border-border bg-card/40 p-4">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-semibold">{locale === "ar" ? "الوكلاء النشطون" : "Active Agents"}</span>
                <Cpu className="h-4 w-4 text-primary" />
              </div>
              <p className="text-2xl font-bold mt-2 text-foreground tracking-tight tabular-nums">
                {activeAgents}
              </p>
            </div>

            {/* Card 2: Win Rate */}
            <div className="rounded-xl border border-border bg-card/40 p-4">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-semibold">{locale === "ar" ? "نسبة النجاح" : "Win Rate"}</span>
                <TrendingUp className="h-4 w-4 text-emerald-500" />
              </div>
              <p className="text-2xl font-bold mt-2 text-emerald-500 tracking-tight">
                78.4%
              </p>
            </div>

            {/* Card 3: Total Executions */}
            <div className="rounded-xl border border-border bg-card/40 p-4 col-span-2">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-semibold">{locale === "ar" ? "إجمالي الصفقات المنفّذة" : "Total Executions"}</span>
                <Coins className="h-4 w-4 text-amber-500" />
              </div>
              <p className="text-2xl font-bold mt-2 text-foreground tracking-tight tabular-nums">
                {totalExecutions.toLocaleString()}
              </p>
            </div>

          </div>
        </div>

        {/* Live Logs Stream Display - 3 Columns on desktop */}
        <div className="lg:col-span-3 rounded-2xl border border-border/80 bg-black/60 p-4 shadow-xl backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-border/60 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-xs font-bold text-foreground">
                {locale === "ar" ? "شاشة المراقبة المباشرة للوكيل" : "Live Agent Monitor Terminal"}
              </span>
            </div>
            <span className="text-[10px] font-mono text-muted-foreground uppercase">
              Binance · MT5 Bridge
            </span>
          </div>

          <div className="space-y-2.5 min-h-[220px] max-h-[280px] overflow-y-auto pr-1">
            {logs.map((log) => (
              <div
                key={log.id}
                className="flex items-start justify-between gap-3 text-xs p-2.5 rounded-lg bg-card/30 border border-white/3 hover:border-white/8 transition duration-150 animate-in fade-in slide-in-from-top-1"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center justify-center rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase",
                      log.platform === "Binance"
                        ? "bg-amber-500/10 text-amber-500"
                        : "bg-blue-500/10 text-blue-500",
                    )}
                  >
                    {log.platform}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground flex items-center gap-1.5">
                      <span className={cn(
                        log.type.includes("BUY") ? "text-emerald-500" : log.type.includes("SELL") ? "text-rose-500" : "text-primary"
                      )}>
                        {log.type}
                      </span>
                      <span>{log.symbol}</span>
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{log.detail}</p>
                  </div>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground shrink-0">{log.time}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
}
