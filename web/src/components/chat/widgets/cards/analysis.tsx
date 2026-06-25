"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Activity,
  BarChart3,
  TrendingUp,
  Layers,
  Grid3x3,
  Sparkles,
  Gauge,
  Signal,
  LineChart,
} from "lucide-react";

type ActionFn = (action: string, payload: any) => void;

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

/* ============================================================
 * 9. rsi_gauge — مقياس RSI نصف-دائري
 * ============================================================ */
export function RsiGauge({
  value = 50,
  symbol,
  onAction,
}: {
  value?: number;
  symbol?: string;
  onAction?: ActionFn;
}) {
  const [v, setV] = useState<number>(clamp(value, 0, 100));

  // نصف دائرة من 180° (يسار) إلى 0° (يمين)
  const cx = 110;
  const cy = 110;
  const r = 90;
  const angle = Math.PI * (1 - v / 100); // 0->π , 100->0
  const nx = cx + r * Math.cos(angle);
  const ny = cy - r * Math.sin(angle);

  const arc = (from: number, to: number) => {
    const a0 = Math.PI * (1 - from / 100);
    const a1 = Math.PI * (1 - to / 100);
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy - r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy - r * Math.sin(a1);
    return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
  };

  const zone =
    v < 30
      ? { label: "تشبّع بيعي", color: "text-emerald-400" }
      : v > 70
      ? { label: "تشبّع شرائي", color: "text-rose-400" }
      : { label: "محايد", color: "text-amber-400" };

  return (
    <div
      dir="rtl"
      className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-lg backdrop-blur-md"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-primary">
          <Gauge className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-foreground">مؤشر القوة النسبية RSI</h3>
          {symbol && (
            <p className="text-xs text-muted-foreground">{symbol}</p>
          )}
        </div>
      </div>

      <div className="flex justify-center">
        <svg viewBox="0 0 220 130" className="w-full max-w-[180px]">
          <path d={arc(0, 30)} className="stroke-emerald-500/70" strokeWidth={14} fill="none" strokeLinecap="round" />
          <path d={arc(30, 70)} className="stroke-amber-500/70" strokeWidth={14} fill="none" />
          <path d={arc(70, 100)} className="stroke-rose-500/70" strokeWidth={14} fill="none" strokeLinecap="round" />
          {/* مؤشر */}
          <line
            x1={cx}
            y1={cy}
            x2={nx}
            y2={ny}
            className="stroke-foreground transition-all duration-300"
            strokeWidth={3}
            strokeLinecap="round"
          />
          <circle cx={cx} cy={cy} r={6} className="fill-foreground" />
          <text x={cx} y={70} textAnchor="middle" className="fill-foreground text-2xl font-bold">
            {Math.round(v)}
          </text>
        </svg>
      </div>

      <p className={cn("mb-3 text-center text-sm font-semibold", zone.color)}>
        {zone.label}
      </p>

      <input
        type="range"
        min={0}
        max={100}
        value={v}
        onChange={(e) => setV(Number(e.target.value))}
        className="w-full accent-primary"
      />

      <button
        onClick={() =>
          onAction?.("submit_prompt", {
            text: `حلّل مؤشر RSI الحالي عند القيمة ${Math.round(v)}${
              symbol ? ` على ${symbol}` : ""
            } وأخبرني بالتوصية.`,
          })
        }
        className="mt-3 w-full rounded-xl bg-primary/10 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20"
      >
        تحليل عند هذه القيمة
      </button>
    </div>
  );
}

/* ============================================================
 * 10. macd_meter — أعمدة زخم + خط إشارة
 * ============================================================ */
export function MacdMeter({
  value,
  bars,
  symbol,
  onAction,
}: {
  value?: number;
  bars?: number[];
  symbol?: string;
  onAction?: ActionFn;
}) {
  const data: number[] =
    bars && bars.length
      ? bars
      : Array.from({ length: 16 }, (_, i) =>
          Math.sin(i / 2) * 60 + (value ?? 0) * 0.3
        );

  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => Math.abs(d)), 1);
  const w = 18;
  const gap = 6;
  const h = 90;
  const mid = h / 2;

  // خط إشارة (متوسط متحرك بسيط)
  const sig = data.map((_, i) => {
    const s = data.slice(Math.max(0, i - 2), i + 1);
    return s.reduce((a, b) => a + b, 0) / s.length;
  });
  const toY = (val: number) => mid - (val / max) * (mid - 6);

  return (
    <div
      dir="rtl"
      className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-lg backdrop-blur-md"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-primary">
          <BarChart3 className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-foreground">زخم MACD</h3>
          {symbol && <p className="text-xs text-muted-foreground">{symbol}</p>}
        </div>
        <span
          className={cn(
            "rounded-lg px-2 py-1 text-xs font-bold",
            data[data.length - 1] >= 0
              ? "bg-emerald-500/15 text-emerald-400"
              : "bg-rose-500/15 text-rose-400"
          )}
        >
          {data[data.length - 1] >= 0 ? "زخم صاعد" : "زخم هابط"}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${data.length * (w + gap)} ${h}`}
        className="w-full"
        onMouseLeave={() => setActive(null)}
      >
        <line x1={0} y1={mid} x2={data.length * (w + gap)} y2={mid} className="stroke-border" strokeWidth={1} />
        {data.map((d, i) => {
          const barH = (Math.abs(d) / max) * (mid - 6);
          const x = i * (w + gap);
          const y = d >= 0 ? mid - barH : mid;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={w}
              height={barH}
              rx={3}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "cursor-pointer transition",
                d >= 0 ? "fill-emerald-500/80" : "fill-rose-500/80",
                active === i && "opacity-100",
                active !== null && active !== i && "opacity-40"
              )}
            />
          );
        })}
        {/* خط الإشارة */}
        <polyline
          points={sig.map((s, i) => `${i * (w + gap) + w / 2},${toY(s)}`).join(" ")}
          fill="none"
          className="stroke-amber-400"
          strokeWidth={2}
        />
      </svg>

      {active !== null && (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          العمود {active + 1}: {data[active].toFixed(1)}
        </p>
      )}

      <button
        onClick={() =>
          onAction?.("submit_prompt", {
            text: `اشرح حالة مؤشر MACD${symbol ? ` على ${symbol}` : ""} ودلالة الزخم الحالي.`,
          })
        }
        className="mt-3 w-full rounded-xl bg-primary/10 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20"
      >
        اشرح الزخم
      </button>
    </div>
  );
}

/* ============================================================
 * 11. trend_meter — قرص قوة الاتجاه
 * ============================================================ */
export function TrendMeter({
  score = 0,
  symbol,
  onAction,
}: {
  score?: number;
  symbol?: string;
  onAction?: ActionFn;
}) {
  const [s, setS] = useState<number>(clamp(score, -100, 100));
  const cx = 110;
  const cy = 110;
  const r = 88;
  // -100 -> π (يسار) , +100 -> 0 (يمين)
  const t = (s + 100) / 200; // 0..1
  const angle = Math.PI * (1 - t);
  const nx = cx + r * Math.cos(angle);
  const ny = cy - r * Math.sin(angle);

  const arc = (from: number, to: number) => {
    const t0 = (from + 100) / 200;
    const t1 = (to + 100) / 200;
    const a0 = Math.PI * (1 - t0);
    const a1 = Math.PI * (1 - t1);
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy - r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy - r * Math.sin(a1);
    return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
  };

  const label =
    s > 33 ? "اتجاه صاعد" : s < -33 ? "اتجاه هابط" : "اتجاه عرضي";
  const color =
    s > 33 ? "text-emerald-400" : s < -33 ? "text-rose-400" : "text-amber-400";

  return (
    <div
      dir="rtl"
      className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-lg backdrop-blur-md"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-primary">
          <TrendingUp className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-foreground">قوة الاتجاه</h3>
          {symbol && <p className="text-xs text-muted-foreground">{symbol}</p>}
        </div>
      </div>

      <div className="flex justify-center">
        <svg viewBox="0 0 220 130" className="w-full max-w-[180px]">
          <path d={arc(-100, -33)} className="stroke-rose-500/70" strokeWidth={14} fill="none" strokeLinecap="round" />
          <path d={arc(-33, 33)} className="stroke-amber-500/70" strokeWidth={14} fill="none" />
          <path d={arc(33, 100)} className="stroke-emerald-500/70" strokeWidth={14} fill="none" strokeLinecap="round" />
          <line x1={cx} y1={cy} x2={nx} y2={ny} className="stroke-foreground transition-all duration-300" strokeWidth={3} strokeLinecap="round" />
          <circle cx={cx} cy={cy} r={6} className="fill-foreground" />
          <text x={20} y={125} className="fill-rose-400 text-[10px]">هابط</text>
          <text x={170} y={125} className="fill-emerald-400 text-[10px]">صاعد</text>
          <text x={cx} y={72} textAnchor="middle" className="fill-foreground text-2xl font-bold">
            {Math.round(s)}
          </text>
        </svg>
      </div>

      <p className={cn("mb-3 text-center text-sm font-semibold", color)}>{label}</p>

      <input
        type="range"
        min={-100}
        max={100}
        value={s}
        onChange={(e) => setS(Number(e.target.value))}
        className="w-full accent-primary"
      />

      <button
        onClick={() =>
          onAction?.("submit_prompt", {
            text: `قيّم قوة الاتجاه الحالي (${Math.round(s)})${
              symbol ? ` على ${symbol}` : ""
            } وما الأنسب الآن.`,
          })
        }
        className="mt-3 w-full rounded-xl bg-primary/10 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20"
      >
        قيّم الاتجاه
      </button>
    </div>
  );
}

/* ============================================================
 * 12. sr_ladder — سُلّم دعم/مقاومة قابل للنقر
 * ============================================================ */
export function SrLadder({
  symbol,
  levels = [],
  onAction,
}: {
  symbol?: string;
  levels?: { price: number; type: "support" | "resistance" }[];
  onAction?: ActionFn;
}) {
  const list =
    levels && levels.length
      ? levels
      : [
          { price: 68500, type: "resistance" as const },
          { price: 67200, type: "resistance" as const },
          { price: 65800, type: "support" as const },
          { price: 64100, type: "support" as const },
        ];
  const sorted = [...list].sort((a, b) => b.price - a.price);
  const [sel, setSel] = useState<number | null>(null);

  return (
    <div
      dir="rtl"
      className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-lg backdrop-blur-md"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-primary">
          <Layers className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-foreground">مستويات الدعم والمقاومة</h3>
          {symbol && <p className="text-xs text-muted-foreground">{symbol}</p>}
        </div>
      </div>

      <div className="space-y-2">
        {sorted.map((lv, i) => {
          const isRes = lv.type === "resistance";
          return (
            <button
              key={i}
              onClick={() => {
                setSel(i);
                onAction?.("submit_prompt", {
                  text: `حلّل عند هذا المستوى: ${
                    isRes ? "مقاومة" : "دعم"
                  } ${lv.price}${symbol ? ` على ${symbol}` : ""}.`,
                });
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-sm transition",
                isRes
                  ? "border-rose-500/30 bg-rose-500/5 hover:bg-rose-500/15"
                  : "border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/15",
                sel === i && "ring-2 ring-primary/60"
              )}
            >
              <span
                className={cn(
                  "rounded-md px-2 py-0.5 text-xs font-semibold",
                  isRes ? "bg-rose-500/15 text-rose-400" : "bg-emerald-500/15 text-emerald-400"
                )}
              >
                {isRes ? "مقاومة" : "دعم"}
              </span>
              <span className="font-mono font-bold text-foreground">
                {lv.price.toLocaleString()}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        انقر أي مستوى لتحليله
      </p>
    </div>
  );
}

/* ============================================================
 * 13. mtf_grid — شبكة أطر زمنية × إشارة
 * ============================================================ */
type Signal = "buy" | "sell" | "neutral";
export function MtfGrid({
  rows = [],
  symbol,
  onAction,
}: {
  rows?: { tf: string; signal: Signal }[];
  symbol?: string;
  onAction?: ActionFn;
}) {
  const data =
    rows && rows.length
      ? rows
      : [
          { tf: "M5", signal: "buy" as Signal },
          { tf: "M15", signal: "buy" as Signal },
          { tf: "H1", signal: "neutral" as Signal },
          { tf: "H4", signal: "sell" as Signal },
          { tf: "D1", signal: "buy" as Signal },
        ];

  const styleOf = (s: Signal) =>
    s === "buy"
      ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
      : s === "sell"
      ? "bg-rose-500/15 text-rose-400 hover:bg-rose-500/25"
      : "bg-amber-500/15 text-amber-400 hover:bg-amber-500/25";

  const labelOf = (s: Signal) =>
    s === "buy" ? "شراء" : s === "sell" ? "بيع" : "حياد";

  return (
    <div
      dir="rtl"
      className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-lg backdrop-blur-md"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-primary">
          <Grid3x3 className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-foreground">إشارات الأطر الزمنية</h3>
          {symbol && <p className="text-xs text-muted-foreground">{symbol}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {data.map((r, i) => (
          <button
            key={i}
            onClick={() =>
              onAction?.("submit_prompt", {
                text: `حلّل الإطار الزمني ${r.tf} (الإشارة: ${labelOf(
                  r.signal
                )})${symbol ? ` على ${symbol}` : ""}.`,
              })
            }
            className={cn(
              "flex flex-col items-center gap-1 rounded-xl px-3 py-3 transition",
              styleOf(r.signal)
            )}
          >
            <span className="text-xs font-bold text-foreground">{r.tf}</span>
            <span className="text-xs font-semibold">{labelOf(r.signal)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
 * 14. pattern_card — نمط مكتشف مع شريط ثقة
 * ============================================================ */
export function PatternCard({
  pattern = "نموذج الرأس والكتفين",
  confidence = 72,
  symbol,
  onAction,
}: {
  pattern?: string;
  confidence?: number;
  symbol?: string;
  onAction?: ActionFn;
}) {
  const [open, setOpen] = useState(false);
  const c = clamp(confidence, 0, 100);
  const color =
    c >= 70 ? "bg-emerald-500" : c >= 40 ? "bg-amber-500" : "bg-rose-500";

  return (
    <div
      dir="rtl"
      className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-lg backdrop-blur-md"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-primary">
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-foreground">نمط مكتشف</h3>
          {symbol && <p className="text-xs text-muted-foreground">{symbol}</p>}
        </div>
      </div>

      <p className="mb-2 text-base font-semibold text-foreground">{pattern}</p>

      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>الثقة</span>
        <span className="font-bold text-foreground">{c}%</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all duration-500", color)}
          style={{ width: `${c}%` }}
        />
      </div>

      <button
        onClick={() => {
          setOpen((o) => !o);
          if (!open)
            onAction?.("submit_prompt", {
              text: `أعطني تفاصيل نمط "${pattern}" (ثقة ${c}%)${
                symbol ? ` على ${symbol}` : ""
              } وكيف أتعامل معه.`,
            });
        }}
        className="mt-4 w-full rounded-xl bg-primary/10 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20"
      >
        {open ? "إخفاء" : "تفاصيل"}
      </button>

      {open && (
        <div className="mt-3 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
          تم إرسال طلب التفاصيل للوكيل. سيوضّح لك دلالة النمط ونقاط الدخول
          والخروج المحتملة.
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * 15. confidence_meter — قوس ثقة متحرك
 * ============================================================ */
export function ConfidenceMeter({
  value = 60,
  onAction,
}: {
  value?: number;
  onAction?: ActionFn;
}) {
  const [v, setV] = useState<number>(clamp(value, 0, 100));
  const label =
    v >= 67 ? "جيدة" : v >= 34 ? "متوسطة" : "ضعيفة";
  const color =
    v >= 67 ? "text-emerald-400" : v >= 34 ? "text-amber-400" : "text-rose-400";
  const stroke =
    v >= 67 ? "stroke-emerald-500" : v >= 34 ? "stroke-amber-500" : "stroke-rose-500";

  const R = 52;
  const circ = Math.PI * R; // نصف دائرة
  const offset = circ * (1 - v / 100);

  return (
    <div
      dir="rtl"
      className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-lg backdrop-blur-md"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-primary">
          <Activity className="h-5 w-5" />
        </span>
        <h3 className="text-sm font-bold text-foreground">مستوى الثقة</h3>
      </div>

      <div className="flex justify-center">
        <svg viewBox="0 0 140 80" className="w-full max-w-[200px]">
          <path
            d="M 18 70 A 52 52 0 0 1 122 70"
            fill="none"
            className="stroke-muted"
            strokeWidth={12}
            strokeLinecap="round"
          />
          <path
            d="M 18 70 A 52 52 0 0 1 122 70"
            fill="none"
            className={cn(stroke, "transition-all duration-500")}
            strokeWidth={12}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
          />
          <text x={70} y={66} textAnchor="middle" className="fill-foreground text-2xl font-bold">
            {Math.round(v)}
          </text>
        </svg>
      </div>

      <p className={cn("mb-3 text-center text-sm font-semibold", color)}>
        ثقة {label}
      </p>

      <input
        type="range"
        min={0}
        max={100}
        value={v}
        onChange={(e) => setV(Number(e.target.value))}
        className="w-full accent-primary"
      />

      <button
        onClick={() =>
          onAction?.("submit_prompt", {
            text: `مستوى الثقة الحالي ${Math.round(
              v
            )}% (${label}) — هل أنفّذ الصفقة أم أنتظر؟`,
          })
        }
        className="mt-3 w-full rounded-xl bg-primary/10 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20"
      >
        استشر الوكيل
      </button>
    </div>
  );
}

/* ============================================================
 * 16. signal_strength — مقياس قوة إشارة
 * ============================================================ */
export function SignalStrength({
  score = 0,
  symbol,
  onAction,
}: {
  score?: number;
  symbol?: string;
  onAction?: ActionFn;
}) {
  const [s, setS] = useState<number>(clamp(score, -100, 100));
  const pct = (s + 100) / 2; // 0..100 موضع المؤشر

  const label =
    s >= 60
      ? "شراء قوي"
      : s >= 20
      ? "شراء"
      : s > -20
      ? "حياد"
      : s > -60
      ? "بيع"
      : "بيع قوي";
  const color =
    s >= 20 ? "text-emerald-400" : s <= -20 ? "text-rose-400" : "text-amber-400";

  return (
    <div
      dir="rtl"
      className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-lg backdrop-blur-md"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-primary">
          <Signal className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-foreground">قوة الإشارة</h3>
          {symbol && <p className="text-xs text-muted-foreground">{symbol}</p>}
        </div>
        <span className={cn("text-sm font-bold", color)}>{label}</span>
      </div>

      <div className="relative h-3 w-full overflow-hidden rounded-full bg-gradient-to-l from-emerald-500/70 via-amber-500/60 to-rose-500/70">
        <div
          className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow-lg transition-all duration-300"
          style={{ left: `${pct}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span className="text-emerald-400">شراء قوي</span>
        <span>حياد</span>
        <span className="text-rose-400">بيع قوي</span>
      </div>

      <input
        type="range"
        min={-100}
        max={100}
        value={s}
        onChange={(e) => setS(Number(e.target.value))}
        className="mt-3 w-full accent-primary"
      />

      <button
        onClick={() =>
          onAction?.("submit_prompt", {
            text: `قوة الإشارة الحالية (${Math.round(s)} = ${label})${
              symbol ? ` على ${symbol}` : ""
            } — ما توصيتك؟`,
          })
        }
        className="mt-3 w-full rounded-xl bg-primary/10 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20"
      >
        اطلب التوصية
      </button>
    </div>
  );
}

/* ============================================================
 * 17. indicator_tabs — تبويبات مؤشرات
 * ============================================================ */
export function IndicatorTabs({
  items = [],
  symbol,
  onAction,
}: {
  items?: { key: string; label: string; value: string | number; note?: string }[];
  symbol?: string;
  onAction?: ActionFn;
}) {
  const data =
    items && items.length
      ? items
      : [
          { key: "rsi", label: "RSI", value: 58, note: "محايد قريب من الشراء" },
          { key: "macd", label: "MACD", value: "+0.42", note: "تقاطع صاعد" },
          { key: "ma", label: "MA", value: "صاعد", note: "السعر فوق المتوسط 50" },
        ];
  const [active, setActive] = useState(0);
  const cur = data[active];

  return (
    <div
      dir="rtl"
      className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-lg backdrop-blur-md"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-primary">
          <LineChart className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-foreground">لوحة المؤشرات</h3>
          {symbol && <p className="text-xs text-muted-foreground">{symbol}</p>}
        </div>
      </div>

      <div className="mb-3 flex gap-1 rounded-xl bg-muted p-1">
        {data.map((it, i) => (
          <button
            key={it.key}
            onClick={() => setActive(i)}
            className={cn(
              "flex-1 rounded-lg py-1.5 text-xs font-semibold transition",
              active === i
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {it.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl bg-background/50 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">{cur.label}</span>
          <span className="text-2xl font-bold text-foreground">{cur.value}</span>
        </div>
        {cur.note && (
          <p className="mt-2 text-xs text-muted-foreground">{cur.note}</p>
        )}
      </div>

      <button
        onClick={() =>
          onAction?.("submit_prompt", {
            text: `اشرح مؤشر ${cur.label} (القيمة: ${cur.value})${
              symbol ? ` على ${symbol}` : ""
            } بالتفصيل.`,
          })
        }
        className="mt-3 w-full rounded-xl bg-primary/10 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20"
      >
        اشرح {cur.label}
      </button>
    </div>
  );
}

/* ============================================================
 * خريطة التصدير
 * ============================================================ */
export const ANALYSIS_WIDGETS = {
  rsi_gauge: RsiGauge,
  macd_meter: MacdMeter,
  trend_meter: TrendMeter,
  sr_ladder: SrLadder,
  mtf_grid: MtfGrid,
  pattern_card: PatternCard,
  confidence_meter: ConfidenceMeter,
  signal_strength: SignalStrength,
  indicator_tabs: IndicatorTabs,
};
