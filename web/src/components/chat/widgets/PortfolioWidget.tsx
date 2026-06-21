"use client";

import React from "react";
import { Wallet, TrendingUp, AlertCircle, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface PortfolioWidgetProps {
  balance?: number;
  equity?: number;
  margin?: number;
  openTrades?: number;
  assets?: { name: string; amount: number; value: number; change?: number }[];
  platform?: string;
  currency?: string;
}

export default function PortfolioWidget({
  balance = 10000,
  equity = 10050,
  margin = 250,
  openTrades = 2,
  assets = [
    { name: "BTC", amount: 0.12, value: 8200, change: 2.5 },
    { name: "ETH", amount: 0.5, value: 1600, change: -1.2 },
    { name: "USDT", amount: 200, value: 200, change: 0 },
  ],
  platform = "Binance Futures",
  currency = "USDT",
}: PortfolioWidgetProps) {
  const pnl = equity - balance;
  const pnlPct = (pnl / balance) * 100;
  const isProfit = pnl >= 0;

  return (
    <div className="rounded-xl border border-border bg-card/45 p-4 shadow-lg space-y-4">
      {/* Platform & Header */}
      <div className="flex items-center justify-between border-b border-border/50 pb-2">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary/10 p-1.5 text-primary border border-primary/15">
            <Wallet className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-foreground">نظرة عامة على المحفظة</h4>
            <p className="text-[10px] text-muted-foreground">{platform}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 border border-emerald-500/20 text-emerald-400 text-[9px] font-semibold">
          <ShieldCheck className="h-3 w-3" />
          آمنة ومحمية
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-lg bg-background/50 border border-border/60 p-2.5">
          <span className="text-[10px] text-muted-foreground block">الرصيد الإجمالي</span>
          <span className="text-sm font-bold text-foreground" dir="ltr">
            {balance.toLocaleString()} <span className="text-[10px] text-muted-foreground">{currency}</span>
          </span>
        </div>
        
        <div className="rounded-lg bg-background/50 border border-border/60 p-2.5">
          <span className="text-[10px] text-muted-foreground block">حقوق الملكية (Equity)</span>
          <span className="text-sm font-bold text-foreground" dir="ltr">
            {equity.toLocaleString()} <span className="text-[10px] text-muted-foreground">{currency}</span>
          </span>
        </div>

        <div className="rounded-lg bg-background/50 border border-border/60 p-2.5">
          <span className="text-[10px] text-muted-foreground block">الربح/الخسارة غير المحققة</span>
          <span className={cn("text-sm font-bold flex items-center gap-1", isProfit ? "text-emerald-400" : "text-destructive")} dir="ltr">
            <TrendingUp className={cn("h-3.5 w-3.5", !isProfit && "rotate-180")} />
            {isProfit ? "+" : ""}{pnl.toFixed(2)} ({pnlPct.toFixed(2)}%)
          </span>
        </div>

        <div className="rounded-lg bg-background/50 border border-border/60 p-2.5">
          <span className="text-[10px] text-muted-foreground block">الصفقات النشطة</span>
          <span className="text-sm font-bold text-foreground" dir="ltr">
            {openTrades} <span className="text-[10px] text-muted-foreground">صفقات</span>
          </span>
        </div>
      </div>

      {/* Asset Allocations */}
      <div className="space-y-1.5">
        <h5 className="text-[10px] font-bold text-muted-foreground">توزيع الأصول</h5>
        <div className="space-y-1.5">
          {assets.map((asset) => (
            <div key={asset.name} className="flex items-center justify-between text-xs bg-background/30 px-3 py-2 rounded-lg border border-border/40 hover:bg-background/50 transition">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">{asset.name}</span>
                <span className="text-[10px] text-muted-foreground" dir="ltr">({asset.amount})</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-medium text-foreground" dir="ltr">{asset.value.toLocaleString()} {currency}</span>
                {asset.change !== undefined && asset.change !== 0 && (
                  <span className={cn("text-[10px] font-bold rounded px-1.5 py-0.5", asset.change > 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-destructive/10 text-destructive")}>
                    {asset.change > 0 ? "+" : ""}{asset.change}%
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
