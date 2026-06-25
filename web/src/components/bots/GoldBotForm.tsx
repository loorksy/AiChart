"use client";

import { AlertTriangle, Brain, TrendingUp } from "lucide-react";
import {
  DEFAULT_GOLD_AGENTX_CONFIG,
  GOLD_SYMBOL,
} from "@/lib/strategies/gold/goldDefaults";
import type { CandleTimeframe } from "@/lib/strategies/gold/goldTypes";
import type { BotsMetaResponse } from "@/lib/botsMetaTypes";
import type { ExecutionMode } from "@/components/bots/GridBotForm";

export interface GoldFormState {
  executionMode: ExecutionMode;
  initialLot: number;
  maxLot: number;
  minConfidence: number;
  maxEquityDrawdownPct: number;
  drawdownTightenPct: number;
  survivalDrawdownPct: number;
  stopLossAtrMult: number;
  stopLossPips: number;
  entryTimeframe: CandleTimeframe;
  correlationDxy: string;
  correlationUs10y: string;
  optimizerTradeInterval: number;
}

export const DEFAULT_GOLD_FORM: GoldFormState = {
  executionMode: "live",
  initialLot: DEFAULT_GOLD_AGENTX_CONFIG.initialLot,
  maxLot: DEFAULT_GOLD_AGENTX_CONFIG.maxLot,
  minConfidence: DEFAULT_GOLD_AGENTX_CONFIG.minConfidence,
  maxEquityDrawdownPct: DEFAULT_GOLD_AGENTX_CONFIG.maxEquityDrawdownPct,
  drawdownTightenPct: DEFAULT_GOLD_AGENTX_CONFIG.drawdownTightenPct,
  survivalDrawdownPct: DEFAULT_GOLD_AGENTX_CONFIG.survivalDrawdownPct,
  stopLossAtrMult: DEFAULT_GOLD_AGENTX_CONFIG.stopLossAtrMult ?? 2,
  stopLossPips: DEFAULT_GOLD_AGENTX_CONFIG.stopLossPips ?? 200,
  entryTimeframe: DEFAULT_GOLD_AGENTX_CONFIG.entryTimeframe ?? "M15",
  correlationDxy: DEFAULT_GOLD_AGENTX_CONFIG.correlationSymbols.dxy[0] ?? "DXY",
  correlationUs10y: DEFAULT_GOLD_AGENTX_CONFIG.correlationSymbols.us10y[0] ?? "US10Y",
  optimizerTradeInterval: DEFAULT_GOLD_AGENTX_CONFIG.optimizerTradeInterval,
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
      <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-200/90">
        <div className="flex gap-2">
          <Brain className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <strong>Gold Agent X Ultimate</strong> — محرك ذكاء محلي 100% (بدون
            LLM). مجلس 10 مستشارين · بوابة ثلاثية (Confidence + Quality +
            Score ≥ 60) · صفقة واحدة · لا شبكة · لا martingale.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-200/90">
        <div className="flex gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            حماية equity {form.maxEquityDrawdownPct}% · وضع البقاء عند{" "}
            {form.survivalDrawdownPct}% — ليست ضماناً ضد الخسارة.
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
          <span className="font-medium">إطار الدخول</span>
          <select
            className="input mt-1 w-full"
            value={form.entryTimeframe}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                entryTimeframe: e.target.value as CandleTimeframe,
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

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="font-medium">لوت أساسي</span>
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
          <span className="font-medium">أقصى لوت</span>
          <input
            type="number"
            step="0.01"
            min="0.01"
            className="input mt-1 w-full"
            value={form.maxLot}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                maxLot: Number(e.target.value) || 0.01,
              }))
            }
            dir="ltr"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">حد الثقة (%)</span>
          <input
            type="number"
            min="50"
            max="95"
            className="input mt-1 w-full"
            value={form.minConfidence}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                minConfidence: Number(e.target.value) || 60,
              }))
            }
            dir="ltr"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">وقف ATR ×</span>
          <input
            type="number"
            step="0.1"
            min="0.5"
            max="5"
            className="input mt-1 w-full"
            value={form.stopLossAtrMult}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                stopLossAtrMult: Number(e.target.value) || 2,
              }))
            }
            dir="ltr"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">وقف طوارئ (نقاط)</span>
          <input
            type="number"
            step="10"
            min="50"
            className="input mt-1 w-full"
            value={form.stopLossPips}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                stopLossPips: Number(e.target.value) || 200,
              }))
            }
            dir="ltr"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">محسّن كل (صفقة)</span>
          <input
            type="number"
            min="20"
            max="200"
            className="input mt-1 w-full"
            value={form.optimizerTradeInterval}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                optimizerTradeInterval: Number(e.target.value) || 75,
              }))
            }
            dir="ltr"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">DXY رمز</span>
          <input
            type="text"
            className="input mt-1 w-full"
            value={form.correlationDxy}
            onChange={(e) =>
              setForm((f) => ({ ...f, correlationDxy: e.target.value }))
            }
            dir="ltr"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">US10Y رمز</span>
          <input
            type="text"
            className="input mt-1 w-full"
            value={form.correlationUs10y}
            onChange={(e) =>
              setForm((f) => ({ ...f, correlationUs10y: e.target.value }))
            }
            dir="ltr"
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="font-medium">حماية equity (%)</span>
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
        <label className="block text-sm">
          <span className="font-medium">شدّ عند DD (%)</span>
          <input
            type="number"
            step="1"
            min="5"
            max="40"
            className="input mt-1 w-full"
            value={form.drawdownTightenPct}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                drawdownTightenPct: Number(e.target.value) || 15,
              }))
            }
            dir="ltr"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">وضع البقاء (%)</span>
          <input
            type="number"
            step="1"
            min="10"
            max="50"
            className="input mt-1 w-full"
            value={form.survivalDrawdownPct}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                survivalDrawdownPct: Number(e.target.value) || 20,
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
          تشغيل Gold Agent X
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
