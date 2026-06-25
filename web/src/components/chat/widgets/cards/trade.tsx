"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Ticket,
  Zap,
  XCircle,
  SlidersHorizontal,
  Calculator,
  Scale,
  Layers,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  Minus,
  ShieldCheck,
  Target,
  ShieldX,
} from "lucide-react";

type ActionFn = (action: string, payload: any) => void;

/* ============================================================
   أدوات مساعدة
   ============================================================ */
const fmt = (n: number, d = 2) =>
  Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: d }) : "—";

const sideLabel = (s: string) => (s === "sell" || s === "بيع" ? "بيع" : "شراء");
const isSell = (s: string) => s === "sell" || s === "بيع";

/* ============================================================
   1) order_ticket — تذكرة أمر قابلة للتعديل
   ============================================================ */
export function OrderTicket({
  symbol = "BTCUSDT",
  side = "buy",
  notional = 100,
  entry = 0,
  stop_loss = 0,
  take_profit = 0,
  intentId,
  balance = 1000,
  editable = true,
  onAction,
}: {
  symbol?: string;
  side?: string;
  notional?: number;
  entry?: number;
  stop_loss?: number;
  take_profit?: number;
  intentId?: string;
  balance?: number;
  editable?: boolean;
  onAction?: ActionFn;
}) {
  const [dir, setDir] = useState(isSell(side) ? "sell" : "buy");
  const [size, setSize] = useState(Number(notional) || 100);
  const [sl, setSl] = useState(Number(stop_loss) || 0);
  const [tp, setTp] = useState(Number(take_profit) || 0);
  const px = Number(entry) || 0;
  const sell = dir === "sell";

  // حساب المخاطرة ونسبة العائد/المخاطرة
  const riskDist = px && sl ? Math.abs(px - sl) : 0;
  const rewardDist = px && tp ? Math.abs(tp - px) : 0;
  const rr = riskDist > 0 ? rewardDist / riskDist : 0;
  const riskAmount = px ? (riskDist / px) * size : 0;
  const riskPct = balance ? (riskAmount / balance) * 100 : 0;

  const buildText = () =>
    `${sideLabel(dir)} ${symbol} بحجم ${fmt(size)} USDT` +
    (px ? ` عند سعر ${fmt(px, 4)}` : "") +
    (sl ? ` مع وقف خسارة ${fmt(sl, 4)}` : "") +
    (tp ? ` وهدف ${fmt(tp, 4)}` : "") +
    `.`;

  return (
    <div
      dir="rtl"
      className="relative overflow-hidden rounded-2xl border border-border bg-card p-3 shadow-lg backdrop-blur-md transition-all"
    >
      <div
        className={cn(
          "absolute -left-16 -top-16 h-32 w-32 rounded-full blur-[60px] opacity-20",
          sell ? "bg-rose-500" : "bg-emerald-500"
        )}
      />

      {/* رأس */}
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl bg-muted p-2 text-primary">
            <Ticket className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-base font-bold text-foreground">{symbol}</h4>
            <span className="text-[10px] text-muted-foreground">تذكرة أمر تنفيذ</span>
          </div>
        </div>
        {px > 0 && (
          <div className="text-left">
            <div className="text-[10px] text-muted-foreground">سعر الدخول</div>
            <div className="text-sm font-black text-foreground">${fmt(px, 4)}</div>
          </div>
        )}
      </div>

      {/* جهة الصفقة */}
      <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-background p-1">
        <button
          type="button"
          disabled={!editable}
          onClick={() => setDir("buy")}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition-all",
            !sell
              ? "bg-emerald-500/15 text-emerald-400 shadow-sm ring-1 ring-emerald-500/40"
              : "text-muted-foreground hover:bg-muted"
          )}
        >
          <TrendingUp className="h-4 w-4" /> شراء
        </button>
        <button
          type="button"
          disabled={!editable}
          onClick={() => setDir("sell")}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition-all",
            sell
              ? "bg-rose-500/15 text-rose-400 shadow-sm ring-1 ring-rose-500/40"
              : "text-muted-foreground hover:bg-muted"
          )}
        >
          <TrendingDown className="h-4 w-4" /> بيع
        </button>
      </div>

      {/* الحجم: مزلاق + حقل */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-muted-foreground">الحجم (USDT)</span>
          <input
            type="number"
            disabled={!editable}
            value={size}
            onChange={(e) => setSize(Math.max(0, Number(e.target.value)))}
            className="w-24 rounded-lg border border-border bg-background px-2 py-1 text-left text-xs font-bold text-foreground outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(balance, size)}
          step={10}
          disabled={!editable}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          className={cn(
            "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary",
            sell ? "accent-rose-500" : "accent-emerald-500"
          )}
        />
      </div>

      {/* وقف / هدف */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-rose-400">
            <ShieldX className="h-3 w-3" /> وقف الخسارة
          </label>
          <input
            type="number"
            disabled={!editable}
            value={sl || ""}
            onChange={(e) => setSl(Number(e.target.value))}
            placeholder="0.00"
            className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-left text-xs font-bold text-foreground outline-none focus:ring-1 focus:ring-rose-500"
          />
        </div>
        <div>
          <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
            <Target className="h-3 w-3" /> الهدف
          </label>
          <input
            type="number"
            disabled={!editable}
            value={tp || ""}
            onChange={(e) => setTp(Number(e.target.value))}
            placeholder="0.00"
            className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-left text-xs font-bold text-foreground outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
      </div>

      {/* معاينة حية */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-border bg-background p-2.5 text-center">
          <div className="text-[9px] text-muted-foreground">المخاطرة</div>
          <div
            className={cn(
              "mt-0.5 text-sm font-black",
              riskPct > 3 ? "text-rose-400" : riskPct > 0 ? "text-amber-400" : "text-muted-foreground"
            )}
          >
            {riskPct > 0 ? `${fmt(riskPct, 1)}%` : "—"}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-background p-2.5 text-center">
          <div className="text-[9px] text-muted-foreground">مبلغ المخاطرة</div>
          <div className="mt-0.5 text-sm font-black text-foreground">
            {riskAmount > 0 ? `$${fmt(riskAmount)}` : "—"}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-background p-2.5 text-center">
          <div className="text-[9px] text-muted-foreground">عائد/مخاطرة</div>
          <div
            className={cn(
              "mt-0.5 text-sm font-black",
              rr >= 2 ? "text-emerald-400" : rr >= 1 ? "text-amber-400" : "text-muted-foreground"
            )}
          >
            {rr > 0 ? `${fmt(rr, 2)}R` : "—"}
          </div>
        </div>
      </div>

      {/* أزرار */}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() =>
            intentId
              ? onAction?.("submit_prompt", { text: buildText() })
              : onAction?.("submit_prompt", { text: buildText() })
          }
          className={cn(
            "flex-1 rounded-xl py-2.5 text-xs font-bold text-white shadow-lg transition-all active:scale-[0.98]",
            sell
              ? "bg-gradient-to-r from-rose-500 to-rose-600 shadow-rose-500/20 hover:from-rose-600 hover:to-rose-700"
              : "bg-gradient-to-r from-emerald-500 to-emerald-600 shadow-emerald-500/20 hover:from-emerald-600 hover:to-emerald-700"
          )}
        >
          نفّذ {sideLabel(dir)} {symbol}
        </button>
        <button
          type="button"
          onClick={() => onAction?.("submit_prompt", { text: `إلغاء أمر ${symbol}.` })}
          className="rounded-xl border border-border px-4 text-xs font-semibold text-muted-foreground transition hover:bg-muted"
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   2) quick_trade — صفقة سريعة مدمجة
   ============================================================ */
export function QuickTrade({
  symbol = "BTCUSDT",
  price,
  onAction,
}: {
  symbol?: string;
  price?: number;
  onAction?: ActionFn;
}) {
  const [size, setSize] = useState(50);
  const step = (d: number) => setSize((s) => Math.max(10, s + d));

  const send = (d: "buy" | "sell") =>
    onAction?.("submit_prompt", {
      text: `${sideLabel(d)} سريع ${symbol} بحجم ${fmt(size)} USDT${price ? ` عند ${fmt(price, 4)}` : ""}.`,
    });

  return (
    <div
      dir="rtl"
      className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-lg backdrop-blur-md"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-muted p-1.5 text-primary">
            <Zap className="h-4 w-4" />
          </div>
          <div>
            <span className="text-sm font-bold text-foreground">{symbol}</span>
            {price ? (
              <span className="mr-2 text-[11px] text-muted-foreground">${fmt(price, 4)}</span>
            ) : null}
          </div>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          صفقة سريعة
        </span>
      </div>

      {/* ستيبر الحجم */}
      <div className="mt-3 flex items-center justify-between rounded-xl border border-border bg-background p-1.5">
        <button
          type="button"
          onClick={() => step(-10)}
          className="rounded-lg bg-muted p-2 text-foreground transition hover:bg-border active:scale-95"
        >
          <Minus className="h-4 w-4" />
        </button>
        <div className="text-center">
          <div className="text-base font-black text-foreground">{fmt(size)}</div>
          <div className="text-[9px] text-muted-foreground">USDT</div>
        </div>
        <button
          type="button"
          onClick={() => step(10)}
          className="rounded-lg bg-muted p-2 text-foreground transition hover:bg-border active:scale-95"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* أزرار كبيرة */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => send("buy")}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 py-3 text-sm font-black text-white shadow-lg shadow-emerald-500/20 transition-all hover:from-emerald-600 hover:to-emerald-700 active:scale-[0.98]"
        >
          <ArrowUpRight className="h-5 w-5" /> شراء
        </button>
        <button
          type="button"
          onClick={() => send("sell")}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-rose-500 to-rose-600 py-3 text-sm font-black text-white shadow-lg shadow-rose-500/20 transition-all hover:from-rose-600 hover:to-rose-700 active:scale-[0.98]"
        >
          <ArrowDownRight className="h-5 w-5" /> بيع
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   3) close_position — إغلاق مركز
   ============================================================ */
export function ClosePosition({
  symbol = "BTCUSDT",
  size = 0,
  pnl,
  tradeId,
  intentId,
  onAction,
}: {
  symbol?: string;
  size?: number;
  pnl?: number;
  tradeId?: string;
  intentId?: string;
  onAction?: ActionFn;
}) {
  const [pct, setPct] = useState(100);
  const presets = [25, 50, 75, 100];
  const qty = (Number(size) * pct) / 100;
  const profit = pnl !== undefined ? (Number(pnl) * pct) / 100 : undefined;
  const isWin = (profit ?? 0) >= 0;

  const confirm = () => {
    if (intentId) {
      onAction?.("execute_trade", { intentId });
    } else {
      onAction?.("submit_prompt", {
        text: `أغلق ${pct}% من مركز ${symbol} (${fmt(qty, 4)}).`,
      });
    }
  };

  return (
    <div
      dir="rtl"
      className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-lg backdrop-blur-md"
    >
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl bg-muted p-2 text-amber-400">
            <XCircle className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-base font-bold text-foreground">{symbol}</h4>
            <span className="text-[10px] text-muted-foreground">إغلاق مركز مفتوح</span>
          </div>
        </div>
        {pnl !== undefined && (
          <div className="text-left">
            <div className="text-[10px] text-muted-foreground">الربح/الخسارة الحالي</div>
            <div className={cn("text-sm font-black", Number(pnl) >= 0 ? "text-emerald-400" : "text-rose-400")}>
              {Number(pnl) >= 0 ? "+" : ""}${fmt(Number(pnl))}
            </div>
          </div>
        )}
      </div>

      {/* أزرار النسبة */}
      <div className="mt-4 grid grid-cols-4 gap-2">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPct(p)}
            className={cn(
              "rounded-xl border py-2 text-xs font-bold transition-all",
              pct === p
                ? "border-amber-500/40 bg-amber-500/15 text-amber-400"
                : "border-border bg-background text-muted-foreground hover:bg-muted"
            )}
          >
            {p}%
          </button>
        ))}
      </div>

      {/* مزلاق دقيق */}
      <input
        type="range"
        min={1}
        max={100}
        step={1}
        value={pct}
        onChange={(e) => setPct(Number(e.target.value))}
        className="mt-4 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-amber-500"
      />

      {/* معاينة */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-border bg-background p-3 text-center">
          <div className="text-[9px] text-muted-foreground">الكمية المُغلقة</div>
          <div className="mt-0.5 text-sm font-black text-foreground">{fmt(qty, 4)}</div>
        </div>
        <div className="rounded-xl border border-border bg-background p-3 text-center">
          <div className="text-[9px] text-muted-foreground">الربح المُحقق</div>
          <div className={cn("mt-0.5 text-sm font-black", profit === undefined ? "text-muted-foreground" : isWin ? "text-emerald-400" : "text-rose-400")}>
            {profit === undefined ? "—" : `${isWin ? "+" : ""}$${fmt(profit)}`}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={confirm}
        className="mt-4 w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 py-2.5 text-xs font-bold text-white shadow-lg shadow-amber-500/20 transition-all hover:from-amber-600 hover:to-orange-600 active:scale-[0.98]"
      >
        تأكيد إغلاق {pct}% من {symbol}
      </button>
      {tradeId && (
        <p className="mt-2 text-center text-[9px] text-muted-foreground">معرّف الصفقة: {tradeId}</p>
      )}
    </div>
  );
}

/* ============================================================
   4) modify_sltp — تعديل الوقف/الهدف
   ============================================================ */
export function ModifySltp({
  symbol = "BTCUSDT",
  entry = 0,
  stop_loss = 0,
  take_profit = 0,
  tradeId,
  onAction,
}: {
  symbol?: string;
  entry?: number;
  stop_loss?: number;
  take_profit?: number;
  tradeId?: string;
  onAction?: ActionFn;
}) {
  const [sl, setSl] = useState(Number(stop_loss) || 0);
  const [tp, setTp] = useState(Number(take_profit) || 0);
  const px = Number(entry) || 0;

  const slDist = px && sl ? ((Math.abs(px - sl) / px) * 100) : 0;
  const tpDist = px && tp ? ((Math.abs(tp - px) / px) * 100) : 0;

  const save = () =>
    onAction?.("submit_prompt", {
      text: `عدّل مركز ${symbol}: وقف الخسارة إلى ${fmt(sl, 4)} والهدف إلى ${fmt(tp, 4)}.`,
    });

  return (
    <div
      dir="rtl"
      className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-lg backdrop-blur-md"
    >
      <div className="flex items-center gap-2.5 border-b border-border pb-3">
        <div className="rounded-xl bg-muted p-2 text-primary">
          <SlidersHorizontal className="h-5 w-5" />
        </div>
        <div>
          <h4 className="text-base font-bold text-foreground">{symbol}</h4>
          <span className="text-[10px] text-muted-foreground">تعديل الوقف والهدف</span>
        </div>
        {px > 0 && (
          <div className="mr-auto text-left">
            <div className="text-[9px] text-muted-foreground">الدخول</div>
            <div className="text-xs font-bold text-foreground">${fmt(px, 4)}</div>
          </div>
        )}
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <label className="mb-1 flex items-center justify-between text-[10px] font-semibold text-rose-400">
            <span className="flex items-center gap-1">
              <ShieldX className="h-3 w-3" /> وقف الخسارة
            </span>
            {slDist > 0 && <span className="text-muted-foreground">المسافة {fmt(slDist, 2)}%</span>}
          </label>
          <input
            type="number"
            value={sl || ""}
            onChange={(e) => setSl(Number(e.target.value))}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-left text-sm font-bold text-foreground outline-none focus:ring-1 focus:ring-rose-500"
          />
        </div>
        <div>
          <label className="mb-1 flex items-center justify-between text-[10px] font-semibold text-emerald-400">
            <span className="flex items-center gap-1">
              <Target className="h-3 w-3" /> الهدف
            </span>
            {tpDist > 0 && <span className="text-muted-foreground">المسافة {fmt(tpDist, 2)}%</span>}
          </label>
          <input
            type="number"
            value={tp || ""}
            onChange={(e) => setTp(Number(e.target.value))}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-left text-sm font-bold text-foreground outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={save}
        className="mt-4 w-full rounded-xl bg-gradient-to-r from-primary to-primary/80 py-2.5 text-xs font-bold text-primary-foreground shadow-lg transition-all hover:opacity-90 active:scale-[0.98]"
      >
        حفظ التعديل على {symbol}
      </button>
      {tradeId && (
        <p className="mt-2 text-center text-[9px] text-muted-foreground">معرّف الصفقة: {tradeId}</p>
      )}
    </div>
  );
}

/* ============================================================
   5) position_sizer — حاسبة حجم على أساس المخاطرة
   ============================================================ */
export function PositionSizer({
  balance = 1000,
  riskPct = 1,
  stopDistance = 1,
  onAction,
}: {
  balance?: number;
  riskPct?: number;
  stopDistance?: number;
  onAction?: ActionFn;
}) {
  const [bal, setBal] = useState(Number(balance) || 1000);
  const [risk, setRisk] = useState(Number(riskPct) || 1);
  const [stop, setStop] = useState(Number(stopDistance) || 1);

  const riskAmount = (bal * risk) / 100;
  const suggested = stop > 0 ? (riskAmount / stop) * 100 : 0; // الحجم بالـ USDT

  return (
    <div
      dir="rtl"
      className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-lg backdrop-blur-md"
    >
      <div className="absolute -right-16 -top-16 h-32 w-32 rounded-full bg-primary/30 blur-[60px] opacity-20" />
      <div className="flex items-center gap-2.5 border-b border-border pb-3">
        <div className="rounded-xl bg-muted p-2 text-primary">
          <Calculator className="h-5 w-5" />
        </div>
        <div>
          <h4 className="text-base font-bold text-foreground">حاسبة حجم المركز</h4>
          <span className="text-[10px] text-muted-foreground">على أساس المخاطرة المحددة</span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div>
          <label className="text-[9px] text-muted-foreground">الرصيد $</label>
          <input
            type="number"
            value={bal}
            onChange={(e) => setBal(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-center text-xs font-bold text-foreground outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="text-[9px] text-muted-foreground">المخاطرة %</label>
          <input
            type="number"
            step={0.1}
            value={risk}
            onChange={(e) => setRisk(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-center text-xs font-bold text-foreground outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="text-[9px] text-muted-foreground">مسافة الوقف %</label>
          <input
            type="number"
            step={0.1}
            value={stop}
            onChange={(e) => setStop(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-center text-xs font-bold text-foreground outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* مزلاق المخاطرة */}
      <div className="mt-4">
        <input
          type="range"
          min={0.25}
          max={5}
          step={0.25}
          value={risk}
          onChange={(e) => setRisk(Number(e.target.value))}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
        />
      </div>

      {/* النتيجة */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-border bg-background p-3 text-center">
          <div className="text-[9px] text-muted-foreground">مبلغ المخاطرة</div>
          <div className="mt-0.5 text-sm font-black text-amber-400">${fmt(riskAmount)}</div>
        </div>
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-center">
          <div className="text-[9px] text-muted-foreground">الحجم المقترح</div>
          <div className="mt-0.5 text-sm font-black text-emerald-400">${fmt(suggested)}</div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onAction?.("inject_input", { text: `استخدم حجم ${fmt(suggested)} USDT` })}
        className="mt-4 w-full rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-500/20 transition-all hover:from-emerald-600 hover:to-emerald-700 active:scale-[0.98]"
      >
        استخدم هذا الحجم
      </button>
    </div>
  );
}

/* ============================================================
   6) risk_reward — مصوّر العائد/المخاطرة تفاعلي
   ============================================================ */
export function RiskReward({
  entry = 100,
  stop_loss = 95,
  take_profit = 115,
  onAction,
}: {
  entry?: number;
  stop_loss?: number;
  take_profit?: number;
  onAction?: ActionFn;
}) {
  const [px, setPx] = useState(Number(entry) || 100);
  const [sl, setSl] = useState(Number(stop_loss) || 95);
  const [tp, setTp] = useState(Number(take_profit) || 115);

  const lo = Math.min(px, sl, tp);
  const hi = Math.max(px, sl, tp);
  const range = hi - lo || 1;
  const yOf = (v: number) => 10 + (1 - (v - lo) / range) * 120; // 10..130

  const riskDist = Math.abs(px - sl);
  const rewardDist = Math.abs(tp - px);
  const rr = riskDist > 0 ? rewardDist / riskDist : 0;

  const slY = yOf(sl);
  const tpY = yOf(tp);
  const pxY = yOf(px);

  return (
    <div
      dir="rtl"
      className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-lg backdrop-blur-md"
    >
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl bg-muted p-2 text-primary">
            <Scale className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-base font-bold text-foreground">العائد مقابل المخاطرة</h4>
            <span className="text-[10px] text-muted-foreground">اضبط المستويات بصرياً</span>
          </div>
        </div>
        <div
          className={cn(
            "rounded-full border px-3 py-1 text-sm font-black",
            rr >= 2
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
              : rr >= 1
              ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
              : "border-rose-500/40 bg-rose-500/10 text-rose-400"
          )}
        >
          {fmt(rr, 2)}R
        </div>
      </div>

      <div className="mt-4 flex gap-4">
        {/* المخطط البصري */}
        <svg viewBox="0 0 60 140" className="h-36 w-16 shrink-0">
          {/* منطقة الربح */}
          <rect
            x={20}
            y={Math.min(pxY, tpY)}
            width={20}
            height={Math.abs(tpY - pxY)}
            className="fill-emerald-500/25"
          />
          {/* منطقة الخسارة */}
          <rect
            x={20}
            y={Math.min(pxY, slY)}
            width={20}
            height={Math.abs(slY - pxY)}
            className="fill-rose-500/25"
          />
          {/* خط الهدف */}
          <line x1={14} y1={tpY} x2={46} y2={tpY} className="stroke-emerald-400" strokeWidth={1.5} />
          {/* خط الدخول */}
          <line x1={12} y1={pxY} x2={48} y2={pxY} className="stroke-foreground" strokeWidth={1.5} strokeDasharray="3 2" />
          {/* خط الوقف */}
          <line x1={14} y1={slY} x2={46} y2={slY} className="stroke-rose-400" strokeWidth={1.5} />
        </svg>

        {/* المزالق */}
        <div className="flex-1 space-y-3">
          {[
            { label: "الهدف", v: tp, set: setTp, color: "accent-emerald-500", tone: "text-emerald-400" },
            { label: "الدخول", v: px, set: setPx, color: "accent-foreground", tone: "text-foreground" },
            { label: "الوقف", v: sl, set: setSl, color: "accent-rose-500", tone: "text-rose-400" },
          ].map((row) => (
            <div key={row.label}>
              <div className="mb-1 flex items-center justify-between text-[10px]">
                <span className={cn("font-semibold", row.tone)}>{row.label}</span>
                <span className="font-bold text-foreground">{fmt(row.v, 2)}</span>
              </div>
              <input
                type="range"
                min={lo - range * 0.5}
                max={hi + range * 0.5}
                step={range / 100 || 0.01}
                value={row.v}
                onChange={(e) => row.set(Number(e.target.value))}
                className={cn("h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted", row.color)}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-2.5 text-center">
          <div className="text-[9px] text-muted-foreground">المخاطرة</div>
          <div className="mt-0.5 text-sm font-black text-rose-400">{fmt(riskDist, 2)}</div>
        </div>
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-center">
          <div className="text-[9px] text-muted-foreground">العائد</div>
          <div className="mt-0.5 text-sm font-black text-emerald-400">{fmt(rewardDist, 2)}</div>
        </div>
      </div>

      <button
        type="button"
        onClick={() =>
          onAction?.("submit_prompt", {
            text: `جهّز صفقة بدخول ${fmt(px, 4)} ووقف ${fmt(sl, 4)} وهدف ${fmt(tp, 4)} (عائد/مخاطرة ${fmt(rr, 2)}R).`,
          })
        }
        className="mt-4 w-full rounded-xl border border-border bg-background py-2.5 text-xs font-bold text-foreground transition hover:bg-muted active:scale-[0.98]"
      >
        استخدم هذه المستويات
      </button>
    </div>
  );
}

/* ============================================================
   7) bracket_order — أمر بثلاث طبقات
   ============================================================ */
export function BracketOrder({
  symbol = "BTCUSDT",
  side = "buy",
  onAction,
}: {
  symbol?: string;
  side?: string;
  onAction?: ActionFn;
}) {
  const [dir, setDir] = useState(isSell(side) ? "sell" : "buy");
  const [type, setType] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState<number>(0);
  const [sl, setSl] = useState<number>(0);
  const [tp, setTp] = useState<number>(0);
  const sell = dir === "sell";

  const send = () =>
    onAction?.("submit_prompt", {
      text:
        `أمر ${sideLabel(dir)} ${symbol} ` +
        (type === "limit" ? `معلّق عند ${fmt(limitPrice, 4)}` : "سوق") +
        (sl ? ` مع وقف ${fmt(sl, 4)}` : "") +
        (tp ? ` وهدف ${fmt(tp, 4)}` : "") +
        `.`,
    });

  return (
    <div
      dir="rtl"
      className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-lg backdrop-blur-md"
    >
      <div className="flex items-center gap-2.5 border-b border-border pb-3">
        <div className="rounded-xl bg-muted p-2 text-primary">
          <Layers className="h-5 w-5" />
        </div>
        <div>
          <h4 className="text-base font-bold text-foreground">{symbol}</h4>
          <span className="text-[10px] text-muted-foreground">أمر بثلاث طبقات (Bracket)</span>
        </div>
      </div>

      {/* جهة + نوع */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-background p-1">
          <button
            type="button"
            onClick={() => setDir("buy")}
            className={cn(
              "rounded-lg py-1.5 text-[11px] font-bold transition",
              !sell ? "bg-emerald-500/15 text-emerald-400" : "text-muted-foreground"
            )}
          >
            شراء
          </button>
          <button
            type="button"
            onClick={() => setDir("sell")}
            className={cn(
              "rounded-lg py-1.5 text-[11px] font-bold transition",
              sell ? "bg-rose-500/15 text-rose-400" : "text-muted-foreground"
            )}
          >
            بيع
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-background p-1">
          <button
            type="button"
            onClick={() => setType("market")}
            className={cn(
              "rounded-lg py-1.5 text-[11px] font-bold transition",
              type === "market" ? "bg-primary/15 text-primary" : "text-muted-foreground"
            )}
          >
            سوق
          </button>
          <button
            type="button"
            onClick={() => setType("limit")}
            className={cn(
              "rounded-lg py-1.5 text-[11px] font-bold transition",
              type === "limit" ? "bg-primary/15 text-primary" : "text-muted-foreground"
            )}
          >
            معلّق
          </button>
        </div>
      </div>

      {/* الطبقات */}
      <div className="mt-4 space-y-2">
        {type === "limit" && (
          <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 p-2.5">
            <span className="w-20 text-[10px] font-semibold text-primary">سعر معلّق</span>
            <input
              type="number"
              value={limitPrice || ""}
              onChange={(e) => setLimitPrice(Number(e.target.value))}
              placeholder="0.00"
              className="flex-1 rounded-lg border border-border bg-background px-2 py-1 text-left text-xs font-bold text-foreground outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        )}
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/5 p-2.5">
          <span className="flex w-20 items-center gap-1 text-[10px] font-semibold text-rose-400">
            <ShieldX className="h-3 w-3" /> وقف
          </span>
          <input
            type="number"
            value={sl || ""}
            onChange={(e) => setSl(Number(e.target.value))}
            placeholder="0.00"
            className="flex-1 rounded-lg border border-border bg-background px-2 py-1 text-left text-xs font-bold text-foreground outline-none focus:ring-1 focus:ring-rose-500"
          />
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-2.5">
          <span className="flex w-20 items-center gap-1 text-[10px] font-semibold text-emerald-400">
            <Target className="h-3 w-3" /> هدف
          </span>
          <input
            type="number"
            value={tp || ""}
            onChange={(e) => setTp(Number(e.target.value))}
            placeholder="0.00"
            className="flex-1 rounded-lg border border-border bg-background px-2 py-1 text-left text-xs font-bold text-foreground outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={send}
        className={cn(
          "mt-4 w-full rounded-xl py-2.5 text-xs font-bold text-white shadow-lg transition-all active:scale-[0.98]",
          sell
            ? "bg-gradient-to-r from-rose-500 to-rose-600 shadow-rose-500/20 hover:from-rose-600 hover:to-rose-700"
            : "bg-gradient-to-r from-emerald-500 to-emerald-600 shadow-emerald-500/20 hover:from-emerald-600 hover:to-emerald-700"
        )}
      >
        إرسال أمر {sideLabel(dir)} {type === "limit" ? "معلّق" : "سوق"}
      </button>
    </div>
  );
}

/* ============================================================
   8) trade_confirm — تأكيد نهائي مصغّر
   ============================================================ */
export function TradeConfirm({
  symbol = "BTCUSDT",
  side = "buy",
  notional = 100,
  intentId,
  onAction,
}: {
  symbol?: string;
  side?: string;
  notional?: number;
  intentId?: string;
  onAction?: ActionFn;
}) {
  const [busy, setBusy] = useState<"none" | "approve" | "reject">("none");
  const sell = isSell(side);

  const approve = () => {
    setBusy("approve");
    onAction?.("execute_trade", { intentId });
  };
  const reject = () => {
    setBusy("reject");
    onAction?.("reject_trade", { intentId });
  };

  return (
    <div
      dir="rtl"
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-card p-4 shadow-lg backdrop-blur-md",
        sell ? "border-rose-500/30" : "border-emerald-500/30"
      )}
    >
      <div
        className={cn(
          "absolute -left-12 -top-12 h-24 w-24 rounded-full blur-[50px] opacity-20",
          sell ? "bg-rose-500" : "bg-emerald-500"
        )}
      />
      <div className="flex items-center gap-2.5">
        <div
          className={cn(
            "rounded-xl p-2",
            sell ? "bg-rose-500/10 text-rose-400" : "bg-emerald-500/10 text-emerald-400"
          )}
        >
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <div>
          <h4 className="text-sm font-bold text-foreground">تأكيد الصفقة</h4>
          <span className="text-[10px] text-muted-foreground">مراجعة أخيرة قبل التنفيذ</span>
        </div>
      </div>

      {/* الملخص */}
      <div className="mt-3 flex items-center justify-between rounded-xl border border-border bg-background p-3">
        <div>
          <div className="text-sm font-black text-foreground">{symbol}</div>
          <div className="text-[10px] text-muted-foreground">الحجم {fmt(Number(notional))} USDT</div>
        </div>
        <div
          className={cn(
            "flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-bold",
            sell
              ? "border-rose-500/40 bg-rose-500/10 text-rose-400"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
          )}
        >
          {sell ? <TrendingDown className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />}
          {sideLabel(side)}
        </div>
      </div>

      {/* أزرار */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy !== "none"}
          onClick={approve}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 py-2 text-xs font-bold text-white shadow-md shadow-emerald-500/20 transition-all hover:from-emerald-600 hover:to-emerald-700 active:scale-[0.98] disabled:opacity-50"
        >
          <ShieldCheck className="h-4 w-4" />
          {busy === "approve" ? "جارٍ التنفيذ..." : "موافقة وتنفيذ"}
        </button>
        <button
          type="button"
          disabled={busy !== "none"}
          onClick={reject}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-background py-2 text-xs font-bold text-muted-foreground transition hover:bg-muted active:scale-[0.98] disabled:opacity-50"
        >
          <XCircle className="h-4 w-4" />
          {busy === "reject" ? "جارٍ الرفض..." : "رفض"}
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   scalp_trade — تصوّر صفقة سكالب منفّذة (دخول/وقف/هدف/اتجاه/حالة)
   ============================================================ */
export function ScalpTrade({
  symbol = "",
  side = "buy",
  entry = 0,
  stop_loss = 0,
  take_profit = 0,
  status = "open",
  confidence,
  mode = "paper",
  rationale,
}: {
  symbol?: string;
  side?: string;
  entry?: number;
  stop_loss?: number;
  take_profit?: number;
  status?: string;
  confidence?: number;
  mode?: string;
  rationale?: string;
}) {
  const sell = isSell(side);
  const e = Number(entry) || 0;
  const sl = Number(stop_loss) || 0;
  const tp = Number(take_profit) || 0;
  // Vertical price ladder: map prices to y within [lo,hi].
  const vals = [e, sl, tp].filter((v) => v > 0);
  const hi = vals.length ? Math.max(...vals) : 1;
  const lo = vals.length ? Math.min(...vals) : 0;
  const span = hi - lo || 1;
  const y = (v: number) => 8 + (1 - (v - lo) / span) * 84; // 8..92
  const statusAr =
    status === "open" ? "مفتوحة" :
    status === "executed" ? "نُفّذت" :
    status === "closed" ? "مغلقة" :
    status === "failed" ? "فشلت" : status;
  const accent = sell ? "rose" : "emerald";

  return (
    <div dir="rtl" className={cn("relative mt-3 overflow-hidden rounded-2xl border bg-card/50 p-4 shadow-lg backdrop-blur-md", sell ? "border-rose-500/25" : "border-emerald-500/25")}>
      <div className={cn("pointer-events-none absolute -left-16 -top-16 h-32 w-32 rounded-full opacity-[0.12] blur-[60px]", sell ? "bg-rose-500" : "bg-emerald-500")} />
      <div className="flex items-center justify-between border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          {sell ? <TrendingDown className="h-4 w-4 text-rose-400" /> : <TrendingUp className="h-4 w-4 text-emerald-400" />}
          <span className="text-sm font-bold" dir="ltr">{symbol}</span>
          <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold", sell ? "bg-rose-500/15 text-rose-400 border-rose-500/30" : "bg-emerald-500/15 text-emerald-400 border-emerald-500/30")}>
            {sideLabel(side)}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">{mode === "live" ? "حقيقي" : "تجريبي"}</span>
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-foreground">{statusAr}</span>
        </div>
      </div>

      <div className="mt-3 flex gap-4">
        {/* SVG price ladder */}
        <svg viewBox="0 0 60 100" className="h-28 w-14 shrink-0">
          <line x1="30" y1="6" x2="30" y2="94" stroke="currentColor" className="text-border" strokeWidth="1" />
          {tp > 0 && <g><line x1="14" y1={y(tp)} x2="46" y2={y(tp)} stroke="currentColor" className="text-emerald-400" strokeWidth="2" /><circle cx="30" cy={y(tp)} r="2.5" className="fill-emerald-400" /></g>}
          {e > 0 && <g><line x1="16" y1={y(e)} x2="44" y2={y(e)} stroke="currentColor" className="text-foreground" strokeWidth="2" strokeDasharray="3 2" /><circle cx="30" cy={y(e)} r="2.5" className="fill-foreground" /></g>}
          {sl > 0 && <g><line x1="14" y1={y(sl)} x2="46" y2={y(sl)} stroke="currentColor" className="text-rose-400" strokeWidth="2" /><circle cx="30" cy={y(sl)} r="2.5" className="fill-rose-400" /></g>}
        </svg>
        <div className="flex-1 space-y-1.5 text-xs">
          <Level icon={<Target className="h-3 w-3" />} label="هدف" value={tp || null} tone="text-emerald-400" />
          <Level icon={<TrendingUp className="h-3 w-3" />} label="دخول" value={e || null} tone="text-foreground" />
          <Level icon={<ShieldX className="h-3 w-3" />} label="وقف" value={sl || null} tone="text-rose-400" />
          {confidence != null && (
            <div className="pt-1">
              <div className="mb-0.5 flex justify-between text-[10px] text-muted-foreground"><span>الثقة</span><span className="text-foreground">{confidence}%</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", `bg-${accent}-500`)} style={{ width: `${Math.max(0, Math.min(100, confidence))}%` }} /></div>
            </div>
          )}
        </div>
      </div>
      {rationale && <p className="mt-3 rounded-xl border border-border/50 bg-background/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">{rationale}</p>}
    </div>
  );
}

function Level({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number | null; tone: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/40 px-2 py-1">
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">{icon}{label}</span>
      <span className={cn("text-xs font-bold tabular-nums", tone)} dir="ltr">{value != null ? value : "—"}</span>
    </div>
  );
}

/* ============================================================
   خريطة التصدير
   ============================================================ */
export const TRADE_WIDGETS = {
  order_ticket: OrderTicket,
  quick_trade: QuickTrade,
  close_position: ClosePosition,
  modify_sltp: ModifySltp,
  position_sizer: PositionSizer,
  risk_reward: RiskReward,
  bracket_order: BracketOrder,
  trade_confirm: TradeConfirm,
  scalp_trade: ScalpTrade,
};
