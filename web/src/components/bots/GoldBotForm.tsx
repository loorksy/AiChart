"use client";

import { AlertTriangle, TrendingUp } from "lucide-react";
import { DEFAULT_GOLD_CONFIG, GOLD_SYMBOL } from "@/lib/strategies/gold/goldDefaults";
import type { CandleTimeframe } from "@/lib/strategies/gold/goldTypes";
import type { BotsMetaResponse } from "@/lib/botsMetaTypes";
import type { ExecutionMode } from "@/components/bots/GridBotForm";

export interface GoldFormState {
  executionMode: ExecutionMode;
  initialLot: number;
  gridStepPips: number;
  takeProfitPips: number;
  multiplier: number;
  maxLevels: number;
  maxTotalLot: number;
  maxLotCap: number;
  candleTimeframe: CandleTimeframe;
  maxEquityDrawdownPct: number;
}

export const DEFAULT_GOLD_FORM: GoldFormState = {
  executionMode: "live",
  initialLot: DEFAULT_GOLD_CONFIG.initialLot,
  gridStepPips: DEFAULT_GOLD_CONFIG.gridStepPips,
  takeProfitPips: DEFAULT_GOLD_CONFIG.takeProfitPips,
  multiplier: DEFAULT_GOLD_CONFIG.multiplier,
  maxLevels: DEFAULT_GOLD_CONFIG.maxLevels,
  maxTotalLot: DEFAULT_GOLD_CONFIG.maxTotalLot,
  maxLotCap: DEFAULT_GOLD_CONFIG.maxLotCap,
  candleTimeframe: DEFAULT_GOLD_CONFIG.candleTimeframe,
  maxEquityDrawdownPct: DEFAULT_GOLD_CONFIG.maxEquityDrawdownPct,
};

export function GoldBotForm({
  form,
  setForm,
  meta,
  busy,
  onSubmit,
  onCancel,
}: {
  form: GoldFormState;
  setForm: React.Dispatch<React.SetStateAction<GoldFormState>>;
  meta: BotsMetaResponse | null;
  busy: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const xauInWatch = meta?.symbols.some(
    (s) =>
      s.symbol.toUpperCase().replace(/M$/, "") === GOLD_SYMBOL &&
      s.tradable !== false,
  );

  return (
    <div className="mt-4 space-y-4 border-b border-border pb-4">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200/90">
        <div className="flex gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Martingale على الذهب خطير جداً — تقلبات XAUUSD قد تستنزف الهامش
            بسرعة. حماية equity {form.maxEquityDrawdownPct}% ليست ضماناً ضد
            التصفير.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-yellow-500/25 bg-yellow-500/5 p-3">
        <p className="text-sm font-medium text-yellow-200">ذهب XAUUSD</p>
        <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
          {GOLD_SYMBOL} · MT5 فقط
        </p>
        {meta && (
          <p className="mt-2 text-xs">
            {xauInWatch
              ? "✓ XAUUSD متاح في Market Watch"
              : "⚠ أضف XAUUSD إلى Market Watch في MT5 قبل التشغيل"}
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium">إطار الشموع (دخول)</span>
          <select
            className="input mt-1 w-full"
            value={form.candleTimeframe}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                candleTimeframe: e.target.value as CandleTimeframe,
              }))
            }
          >
            <option value="M5">M5</option>
            <option value="M15">M15 (افتراضي)</option>
            <option value="H1">H1</option>
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
            <option value="paper">تجريبي — محاكاة</option>
            <option value="live">حقيقي — MT5</option>
          </select>
        </label>
      </div>

      <p className="text-xs text-muted-foreground">
        الدخول تلقائي من أنماط الشموع (Engulfing، Hammer، …) أو اتجاه آخر شمعة
        مغلقة. خطوة الشبكة و TP بالنقاط (200 نقطة ≈ $2 على الذهب).
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
          <span className="font-medium">خطوة الشبكة (نقاط)</span>
          <input
            type="number"
            step="10"
            min="10"
            className="input mt-1 w-full"
            value={form.gridStepPips}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                gridStepPips: Number(e.target.value) || 100,
              }))
            }
            dir="ltr"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">هدف الربح (نقاط)</span>
          <input
            type="number"
            step="10"
            min="10"
            className="input mt-1 w-full"
            value={form.takeProfitPips}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                takeProfitPips: Number(e.target.value) || 50,
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
          <span className="font-medium">أقصى لوت/صفقة</span>
          <input
            type="number"
            step="0.01"
            min="0.01"
            className="input mt-1 w-full"
            value={form.maxLotCap}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                maxLotCap: Number(e.target.value) || 0.01,
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
        <label className="block text-sm sm:col-span-2">
          <span className="font-medium">حماية equity (% خسارة عائمة)</span>
          <input
            type="number"
            step="1"
            min="5"
            max="50"
            className="input mt-1 w-full"
            value={form.maxEquityDrawdownPct}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                maxEquityDrawdownPct: Number(e.target.value) || 20,
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
          <TrendingUp className="h-4 w-4 text-yellow-400" />
          تشغيل بوت الذهب
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
