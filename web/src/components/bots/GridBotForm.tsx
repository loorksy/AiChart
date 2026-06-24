"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import { BotSymbolPicker } from "@/components/bots/BotSymbolPicker";
import type { BotBrokerSymbol, BotsMetaResponse } from "@/lib/botsMetaTypes";

export type BotSide = "buy" | "sell";
export type BotMarket = "forex" | "crypto";
export type ExecutionMode = "paper" | "live";

export interface GridFormState {
  symbol: string;
  market: BotMarket;
  side: BotSide;
  executionMode: ExecutionMode;
  initialLot: number;
  gridStep: number;
  multiplier: number;
  takeProfit: number;
  maxLevels: number;
  maxTotalLot: number;
}

export const DEFAULT_GRID_FORM: GridFormState = {
  symbol: "",
  market: "forex",
  side: "sell",
  executionMode: "live",
  initialLot: 0.01,
  gridStep: 2,
  multiplier: 2,
  takeProfit: 1,
  maxLevels: 5,
  maxTotalLot: 0.5,
};

export function GridBotForm({
  form,
  setForm,
  meta,
  brokerConnected,
  busy,
  onSubmit,
  onCancel,
  onSymbolsLoaded,
}: {
  form: GridFormState;
  setForm: React.Dispatch<React.SetStateAction<GridFormState>>;
  meta: BotsMetaResponse | null;
  brokerConnected: boolean;
  busy: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  onSymbolsLoaded?: (list: BotBrokerSymbol[]) => void;
}) {
  return (
    <div className="mt-4 space-y-4 border-b border-border pb-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="block text-sm sm:col-span-2">
          <span className="font-medium">الرمز (من الوسيط)</span>
          <div className="mt-2">
            <BotSymbolPicker
              market={form.market}
              value={form.symbol}
              onChange={(symbol) => setForm((f) => ({ ...f, symbol }))}
              connected={brokerConnected}
              onSymbolsLoaded={onSymbolsLoaded}
            />
          </div>
        </div>
        <label className="block text-sm">
          <span className="font-medium">السوق</span>
          <select
            className="input mt-1 w-full"
            value={form.market}
            onChange={(e) => {
              const market = e.target.value as BotMarket;
              setForm((f) => ({ ...f, market, symbol: "" }));
            }}
          >
            <option value="forex">فوركس / MT5</option>
            <option value="crypto">كريبتو / Binance</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium">الاتجاه</span>
          <select
            className="input mt-1 w-full"
            value={form.side}
            onChange={(e) =>
              setForm((f) => ({ ...f, side: e.target.value as BotSide }))
            }
          >
            <option value="sell">بيع (شبكة هبوطية)</option>
            <option value="buy">شراء (شبكة صعودية)</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium">وضع التنفيذ</span>
          <select
            className="input mt-1 w-full"
            value={form.executionMode}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                executionMode: e.target.value as ExecutionMode,
              }))
            }
          >
            <option value="paper">تجريبي — محاكاة على السيرفر</option>
            <option value="live">حقيقي — صفقات فعلية</option>
          </select>
        </label>
      </div>

      <p className="text-xs text-muted-foreground">
        المسافات بالوحدات السعرية (مثلاً XAUUSD: gridStep=2 ≈ $2 بين المستويات).
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="font-medium">لوت أول صفقة</span>
          <input
            type="number"
            step="0.01"
            min="0.01"
            className="input mt-1 w-full"
            value={form.initialLot}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                initialLot: Number(e.target.value) || 0.01,
              }))
            }
            dir="ltr"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">خطوة الشبكة</span>
          <input
            type="number"
            step="0.1"
            min="0.01"
            className="input mt-1 w-full"
            value={form.gridStep}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                gridStep: Number(e.target.value) || 1,
              }))
            }
            dir="ltr"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">المضاعف</span>
          <input
            type="number"
            step="0.1"
            min="1"
            max="3"
            className="input mt-1 w-full"
            value={form.multiplier}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                multiplier: Number(e.target.value) || 1,
              }))
            }
            dir="ltr"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">هدف الربح (سعر)</span>
          <input
            type="number"
            step="0.1"
            min="0.01"
            className="input mt-1 w-full"
            value={form.takeProfit}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                takeProfit: Number(e.target.value) || 0.1,
              }))
            }
            dir="ltr"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">أقصى مستويات</span>
          <input
            type="number"
            min="1"
            max="20"
            className="input mt-1 w-full"
            value={form.maxLevels}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                maxLevels: Number(e.target.value) || 1,
              }))
            }
            dir="ltr"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">أقصى لوت إجمالي</span>
          <input
            type="number"
            step="0.01"
            min="0.01"
            className="input mt-1 w-full"
            value={form.maxTotalLot}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                maxTotalLot: Number(e.target.value) || 0.01,
              }))
            }
            dir="ltr"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy}
          className="btn btn-primary inline-flex items-center gap-2 text-sm"
        >
          {form.side === "sell" ? (
            <TrendingDown className="h-4 w-4" />
          ) : (
            <TrendingUp className="h-4 w-4" />
          )}
          تشغيل بوت الشبكة
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="btn btn-secondary text-sm"
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}
