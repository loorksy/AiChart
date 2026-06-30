"use client";

import {
  Briefcase,
  DollarSign,
  Loader2,
  Sparkles,
  Wifi,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import { TradingStylePicker } from "@/components/market/TradingStylePicker";
import { DrawingLayersMenu } from "@/components/chart/DrawingLayersMenu";
import type { ChartDrawing } from "@/lib/chartDrawings";
import type { MarketType } from "@/lib/markets/types";
import type { TradingStyle } from "@/lib/types";
import { cn } from "@/lib/utils";

function formatCapital(amount: number | null, currency: string): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  return amount.toLocaleString(undefined, {
    maximumFractionDigits: currency === "USDT" ? 2 : 0,
  });
}

/** AiChart actions embedded inside KLineChart Pro period bar (symbol/interval = Pro native). */
export function SmartChartToolbar({
  market,
  tradingStyle,
  onTradingStyleChange,
  onIntervalSuggest,
  isAnalyzing,
  onAnalyze,
  creditsRemaining,
  capitalLoading,
  capitalConnected,
  capitalAmount,
  capitalCurrency,
  capitalLabel,
  forexConnected,
  forexOnline,
  onOpenTrades,
  openTradesCount,
  drawings,
  hiddenLayers,
  onToggleLayer,
  onToggleAllLayers,
  onClearLayers,
}: {
  market: MarketType;
  tradingStyle: TradingStyle;
  onTradingStyleChange: (s: TradingStyle) => void;
  onIntervalSuggest?: (iv: string) => void;
  isAnalyzing: boolean;
  onAnalyze: () => void;
  creditsRemaining?: number | null;
  capitalLoading?: boolean;
  capitalConnected?: boolean;
  capitalAmount?: number | null;
  capitalCurrency?: string;
  capitalLabel?: string | null;
  forexConnected?: boolean;
  forexOnline?: boolean;
  onOpenTrades: () => void;
  openTradesCount?: number;
  drawings: ChartDrawing[];
  hiddenLayers: Set<number>;
  onToggleLayer: (i: number) => void;
  onToggleAllLayers: (hide: boolean) => void;
  onClearLayers: () => void;
}) {
  return (
    <div className="aichart-pro-toolbar-inner" dir="rtl">
      <button
        type="button"
        onClick={onAnalyze}
        disabled={isAnalyzing}
        className={cn("aichart-pro-ctrl aichart-pro-ctrl--primary")}
        title={
          creditsRemaining != null
            ? `تحليل · رصيد ${creditsRemaining}`
            : "تحليل بالذكاء الاصطناعي"
        }
      >
        {isAnalyzing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        <span>تحليل</span>
        {creditsRemaining != null && (
          <span className="text-[10px] opacity-70" dir="ltr">
            ({creditsRemaining})
          </span>
        )}
      </button>

      <TradingStylePicker
        value={tradingStyle}
        onChange={onTradingStyleChange}
        onIntervalSuggest={onIntervalSuggest}
        compact
      />

      <div
        className="aichart-pro-ctrl pointer-events-none tabular-nums"
        dir="ltr"
        title={
          capitalConnected
            ? `${capitalLabel ?? "الحساب"} · equity`
            : "اربط حسابك من الاتصالات"
        }
      >
        <DollarSign className="h-3.5 w-3.5 shrink-0 opacity-70" />
        {capitalLoading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <span className="truncate max-w-[5rem] sm:max-w-none">
            {capitalConnected
              ? `${formatCapital(capitalAmount ?? null, capitalCurrency ?? "USD")} ${capitalCurrency ?? ""}`
              : "—"}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onOpenTrades}
        className="aichart-pro-ctrl"
        title="الصفقات المفتوحة"
      >
        <Briefcase className="h-3.5 w-3.5" />
        <span className="hide-sm">صفقات</span>
        {(openTradesCount ?? 0) > 0 && (
          <span className="aichart-pro-badge">{openTradesCount}</span>
        )}
      </button>

      <DrawingLayersMenu
        drawings={drawings}
        hidden={hiddenLayers}
        onToggleLayer={onToggleLayer}
        onToggleAll={onToggleAllLayers}
        onClear={onClearLayers}
        compact
      />

      {market === "forex" && (
        <Link
          href="/console/connect"
          className={cn(
            "aichart-pro-ctrl",
            forexOnline ? "aichart-pro-ctrl--online" : "aichart-pro-ctrl--offline",
          )}
          title={
            forexOnline
              ? "MetaTrader متصل"
              : "MetaTrader غير متصل — اضغط للإعداد"
          }
        >
          {forexOnline ? (
            <Wifi className="h-3.5 w-3.5" />
          ) : (
            <WifiOff className="h-3.5 w-3.5" />
          )}
          <span className="hide-sm">
            {forexOnline ? "MT" : forexConnected ? "MT!" : "MT?"}
          </span>
        </Link>
      )}
    </div>
  );
}
