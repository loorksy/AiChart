"use client";

import React from "react";
import { TrendingUp, TrendingDown, RefreshCw, BarChart2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AnalysisWidgetProps {
  symbol: string;
  price: string | number;
  trend: "bullish" | "bearish" | "neutral" | string;
  rsi?: string | number;
  macd?: string;
  support?: string | number;
  resistance?: string | number;
  summary: string;
  onAction?: (action: string, payload: any) => void;
}

export default function AnalysisWidget({
  symbol,
  price,
  trend,
  rsi,
  macd,
  support,
  resistance,
  summary,
  onAction,
}: AnalysisWidgetProps) {
  const isBullish = trend.toLowerCase() === "bullish" || trend === "صاعد";
  const isBearish = trend.toLowerCase() === "bearish" || trend === "هابط";

  const trendLabel = isBullish ? "صاعد (Bullish)" : isBearish ? "هابط (Bearish)" : "حيادي (Neutral)";
  const trendBg = isBullish
    ? "from-emerald-500/10 to-emerald-600/5 border-emerald-500/30 text-emerald-400"
    : isBearish
    ? "from-rose-500/10 to-rose-600/5 border-rose-500/30 text-rose-400"
    : "from-zinc-800/20 to-zinc-900/5 border-zinc-700/30 text-zinc-300";

  return (
    <div className={cn("relative overflow-hidden rounded-2xl border bg-zinc-900/40 p-5 shadow-xl backdrop-blur-md transition-all duration-300 hover:shadow-2xl hover:border-white/10", isBullish ? "border-emerald-500/20" : isBearish ? "border-rose-500/20" : "border-white/[0.06]")}>
      
      {/* Glow Effects */}
      <div className={cn("absolute -right-16 -top-16 h-32 w-32 rounded-full blur-[60px] opacity-20", isBullish ? "bg-emerald-500" : isBearish ? "bg-rose-500" : "bg-zinc-500")} />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
        <div className="flex items-center gap-2.5">
          <div className={cn("rounded-xl p-2", isBullish ? "bg-emerald-500/10 text-emerald-400" : isBearish ? "bg-rose-500/10 text-rose-400" : "bg-zinc-800 text-zinc-400")}>
            <BarChart2 className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-base font-bold tracking-tight text-white">{symbol}</h4>
            <span className="text-[10px] text-zinc-400">تحليل فني فوري للزوج</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-black tracking-tight text-white">${price}</div>
          <div className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold mt-1", trendBg)}>
            {isBullish ? <TrendingUp className="h-3 w-3" /> : isBearish ? <TrendingDown className="h-3 w-3" /> : null}
            <span>{trendLabel}</span>
          </div>
        </div>
      </div>

      {/* Indicators Grid */}
      <div className="grid grid-cols-2 gap-3 my-4 sm:grid-cols-4">
        {rsi !== undefined && (
          <div className="rounded-xl border border-white/[0.04] bg-white/[0.02] p-2.5">
            <span className="text-[9px] text-zinc-500 block">مؤشر القوة النسبية (RSI)</span>
            <span className="text-xs font-bold text-zinc-200 mt-0.5 block">{rsi}</span>
          </div>
        )}
        {macd && (
          <div className="rounded-xl border border-white/[0.04] bg-white/[0.02] p-2.5">
            <span className="text-[9px] text-zinc-500 block">الزخم (MACD)</span>
            <span className="text-xs font-bold text-zinc-200 mt-0.5 block truncate">{macd}</span>
          </div>
        )}
        {support !== undefined && (
          <div className="rounded-xl border border-white/[0.04] bg-white/[0.02] p-2.5">
            <span className="text-[9px] text-zinc-500 block">منطقة الدعم</span>
            <span className="text-xs font-bold text-emerald-400 mt-0.5 block">${support}</span>
          </div>
        )}
        {resistance !== undefined && (
          <div className="rounded-xl border border-white/[0.04] bg-white/[0.02] p-2.5">
            <span className="text-[9px] text-zinc-500 block">منطقة المقاومة</span>
            <span className="text-xs font-bold text-rose-400 mt-0.5 block">${resistance}</span>
          </div>
        )}
      </div>

      {/* Analysis Rationale */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.01] p-3 text-xs leading-relaxed text-zinc-300">
        <h5 className="font-bold text-white mb-1.5 flex items-center gap-1">
          <ShieldAlert className="h-3.5 w-3.5 text-zinc-400" />
          خلاصة رؤية الوكيل:
        </h5>
        <p>{summary}</p>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 mt-4">
        <button
          type="button"
          onClick={() => onAction?.("submit_prompt", { text: `شراء ${symbol} فوري` })}
          className="flex-1 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-bold py-2 text-xs rounded-xl shadow-lg shadow-emerald-500/10 active:scale-[0.98] transition-all cursor-pointer text-center"
        >
          طلب شراء (Buy)
        </button>
        <button
          type="button"
          onClick={() => onAction?.("submit_prompt", { text: `بيع ${symbol} فوري` })}
          className="flex-1 bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 text-white font-bold py-2 text-xs rounded-xl shadow-lg shadow-rose-500/10 active:scale-[0.98] transition-all cursor-pointer text-center"
        >
          طلب بيع (Sell)
        </button>
        <button
          type="button"
          onClick={() => onAction?.("submit_prompt", { text: `مراقبة الأسعار ${symbol}` })}
          className="rounded-xl border border-white/10 hover:bg-white/[0.06] text-zinc-300 font-semibold p-2 text-xs transition cursor-pointer"
          title="تفعيل التنبيهات"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

    </div>
  );
}
