"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Gauge as GaugeIcon,
  Loader2,
  Activity,
  BarChart3,
  LayoutGrid,
  Clock,
  TrendingUp,
  TrendingDown,
  PieChart,
} from "lucide-react";

type ActionFn = (action: string, payload: any) => void;

/* ============================================================
   أدوات مشتركة
   ============================================================ */

const PALETTE = [
  "#10b981", // emerald
  "#3b82f6", // blue
  "#f59e0b", // amber
  "#f43f5e", // rose
  "#a855f7", // purple
  "#14b8a6", // teal
  "#eab308", // yellow
  "#ec4899", // pink
];

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const polar = (angle: number) => {
    const a = ((angle - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };
  const start = polar(endAngle);
  const end = polar(startAngle);
  const largeArc = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/* ============================================================
   34. gauge — مقياس نصف-دائري عام
   ============================================================ */

export function Gauge({
  value = 0,
  min = 0,
  max = 100,
  label = "المقياس",
  unit = "",
  onAction,
}: {
  value?: number;
  min?: number;
  max?: number;
  label?: string;
  unit?: string;
  onAction?: ActionFn;
}) {
  const [val, setVal] = useState<number>(value);
  const pct = clamp((val - min) / (max - min || 1), 0, 1);
  const angle = -90 + pct * 180; // نصف دائرة من -90 إلى 90

  const cx = 120;
  const cy = 120;
  const r = 90;

  // لون حسب الموضع
  const tone =
    pct < 0.34 ? "#10b981" : pct < 0.67 ? "#f59e0b" : "#f43f5e";

  const needle = (() => {
    const a = ((angle - 90) * Math.PI) / 180;
    return { x: cx + r * 0.82 * Math.cos(a), y: cy + r * 0.82 * Math.sin(a) };
  })();

  return (
    <div
      dir="rtl"
      className="w-full rounded-2xl border border-border bg-card/80 p-4 shadow-lg backdrop-blur-md"
    >
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <GaugeIcon className="h-4 w-4" />
        </span>
        {label}
      </div>

      <div className="flex flex-col items-center">
        <svg viewBox="0 0 240 150" className="w-full max-w-[260px]">
          <path
            d={describeArc(cx, cy, r, -90, 90)}
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth="16"
            strokeLinecap="round"
          />
          <path
            d={describeArc(cx, cy, r, -90, angle)}
            fill="none"
            stroke={tone}
            strokeWidth="16"
            strokeLinecap="round"
            className="transition-all duration-300"
          />
          <line
            x1={cx}
            y1={cy}
            x2={needle.x}
            y2={needle.y}
            stroke={tone}
            strokeWidth="3"
            strokeLinecap="round"
            className="transition-all duration-300"
          />
          <circle cx={cx} cy={cy} r="6" fill={tone} />
        </svg>

        <div className="-mt-6 text-center">
          <div className="text-2xl font-bold text-foreground">
            {val.toLocaleString("ar-EG")}
            {unit ? <span className="text-sm text-muted-foreground"> {unit}</span> : null}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {min} — {max}
          </div>
        </div>
      </div>

      <input
        type="range"
        min={min}
        max={max}
        value={val}
        onChange={(e) => setVal(Number(e.target.value))}
        className="mt-3 w-full accent-primary"
      />

      <button
        onClick={() =>
          onAction?.("submit_prompt", {
            text: `حلّل قيمة ${label} الحالية وهي ${val}${unit ? " " + unit : ""}.`,
          })
        }
        className="mt-3 w-full rounded-xl bg-primary/10 py-2 text-sm font-medium text-primary transition hover:bg-primary/20"
      >
        تحليل القيمة
      </button>
    </div>
  );
}

/* ============================================================
   35. progress_ring — حلقة تقدّم دائرية
   ============================================================ */

export function ProgressRing({
  value = 0,
  label = "التقدّم",
  onAction,
}: {
  value?: number;
  label?: string;
  onAction?: ActionFn;
}) {
  const [val, setVal] = useState<number>(clamp(value, 0, 100));
  const r = 52;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - val / 100);
  const tone = val < 40 ? "#f43f5e" : val < 75 ? "#f59e0b" : "#10b981";

  return (
    <div
      dir="rtl"
      className="w-full rounded-2xl border border-border bg-card/80 p-4 shadow-lg backdrop-blur-md"
    >
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Loader2 className="h-4 w-4" />
        </span>
        {label}
      </div>

      <div className="flex items-center justify-center py-2">
        <div className="relative">
          <svg viewBox="0 0 140 140" className="h-36 w-36 -rotate-90">
            <circle
              cx="70"
              cy="70"
              r={r}
              fill="none"
              stroke="hsl(var(--muted))"
              strokeWidth="12"
            />
            <circle
              cx="70"
              cy="70"
              r={r}
              fill="none"
              stroke={tone}
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              className="transition-all duration-500"
              style={{ filter: `drop-shadow(0 0 6px ${tone}66)` }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold text-foreground">{Math.round(val)}%</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-2">
        <button
          onClick={() => setVal((v) => clamp(v - 5, 0, 100))}
          className="h-8 w-8 rounded-xl border border-border bg-muted text-foreground transition hover:bg-muted/70"
        >
          −
        </button>
        <button
          onClick={() => setVal((v) => clamp(v + 5, 0, 100))}
          className="h-8 w-8 rounded-xl border border-border bg-muted text-foreground transition hover:bg-muted/70"
        >
          +
        </button>
        <button
          onClick={() =>
            onAction?.("submit_prompt", { text: `التقدّم الحالي لـ${label} وصل إلى ${Math.round(val)}%.` })
          }
          className="ms-2 rounded-xl bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition hover:bg-primary/20"
        >
          إرسال
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   36. sparkline — خط مصغّر
   ============================================================ */

export function Sparkline({
  points = [4, 8, 5, 9, 7, 12, 10, 14, 11, 16],
  color = "#10b981",
  onAction,
}: {
  points?: number[];
  color?: string;
  onAction?: ActionFn;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 280;
  const h = 80;
  const pad = 6;
  const data = points.length ? points : [0];
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;

  const coords = data.map((v, i) => {
    const x = pad + (i / (data.length - 1 || 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return { x, y, v };
  });

  const line = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");
  const area = `${line} L ${coords[coords.length - 1].x} ${h - pad} L ${coords[0].x} ${h - pad} Z`;
  const last = data[data.length - 1];
  const first = data[0];
  const up = last >= first;
  const tone = color || (up ? "#10b981" : "#f43f5e");

  return (
    <div
      dir="rtl"
      className="w-full rounded-2xl border border-border bg-card/80 p-4 shadow-lg backdrop-blur-md"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Activity className="h-4 w-4" />
          </span>
          خط مصغّر
        </div>
        <span
          className={cn(
            "flex items-center gap-1 text-xs font-medium",
            up ? "text-emerald-500" : "text-rose-500",
          )}
        >
          {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
          {hover !== null ? data[hover] : last}
        </span>
      </div>

      <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
        <defs>
          <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tone} stopOpacity="0.28" />
            <stop offset="100%" stopColor={tone} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#spark-fill)" />
        <path
          d={line}
          fill="none"
          stroke={tone}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {coords.map((c, i) => (
          <circle
            key={i}
            cx={c.x}
            cy={c.y}
            r={hover === i ? 4 : 0}
            fill={tone}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        {coords.map((c, i) => (
          <rect
            key={`hit-${i}`}
            x={c.x - 8}
            y={0}
            width={16}
            height={h}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>

      <button
        onClick={() => onAction?.("submit_prompt", { text: "اشرح اتجاه هذا الخط المصغّر." })}
        className="mt-2 w-full rounded-xl bg-muted py-1.5 text-xs font-medium text-foreground transition hover:bg-muted/70"
      >
        اشرح الاتجاه
      </button>
    </div>
  );
}

/* ============================================================
   37. bar_compare — أعمدة مقارنة أفقية
   ============================================================ */

export function BarCompare({
  items = [
    { label: "العنصر أ", value: 72 },
    { label: "العنصر ب", value: 48 },
    { label: "العنصر ج", value: 91 },
    { label: "العنصر د", value: 33 },
  ],
  max,
  onAction,
}: {
  items?: { label: string; value: number }[];
  max?: number;
  onAction?: ActionFn;
}) {
  const [active, setActive] = useState<number | null>(null);
  const top = max ?? Math.max(...items.map((i) => i.value), 1);

  return (
    <div
      dir="rtl"
      className="w-full rounded-2xl border border-border bg-card/80 p-4 shadow-lg backdrop-blur-md"
    >
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <BarChart3 className="h-4 w-4" />
        </span>
        مقارنة
      </div>

      <div className="space-y-2.5">
        {items.map((it, i) => {
          const pct = clamp((it.value / top) * 100, 0, 100);
          const color = PALETTE[i % PALETTE.length];
          const sel = active === i;
          return (
            <button
              key={i}
              onClick={() => setActive(sel ? null : i)}
              className="block w-full text-right"
            >
              <div className="mb-1 flex items-center justify-between text-xs">
                <span
                  className={cn(
                    "font-medium transition",
                    sel ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {it.label}
                </span>
                <span className="font-semibold text-foreground">{it.value}</span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${pct}%`,
                    background: color,
                    boxShadow: sel ? `0 0 8px ${color}88` : "none",
                  }}
                />
              </div>
            </button>
          );
        })}
      </div>

      {active !== null && (
        <button
          onClick={() =>
            onAction?.("submit_prompt", {
              text: `ركّز على «${items[active].label}» بقيمة ${items[active].value} وقارنه بالبقية.`,
            })
          }
          className="mt-3 w-full rounded-xl bg-primary/10 py-2 text-sm font-medium text-primary transition hover:bg-primary/20"
        >
          تحليل «{items[active].label}»
        </button>
      )}
    </div>
  );
}

/* ============================================================
   38. stat_grid — شبكة إحصاءات
   ============================================================ */

export function StatGrid({
  stats = [
    { label: "الإيراد", value: "١٢٤ ألف", delta: "+8%", trend: "up" },
    { label: "المستخدمون", value: "٣٬٢٠٠", delta: "+2%", trend: "up" },
    { label: "الارتداد", value: "٤١%", delta: "-3%", trend: "down" },
    { label: "التحويل", value: "٥٫٤%", delta: "+0.6%", trend: "up" },
  ],
  onAction,
}: {
  stats?: { label: string; value: string | number; delta?: string; trend?: "up" | "down" }[];
  onAction?: ActionFn;
}) {
  const [sel, setSel] = useState<number | null>(null);
  const cols = stats.length >= 4 ? "grid-cols-2" : stats.length === 3 ? "grid-cols-3" : "grid-cols-2";

  return (
    <div
      dir="rtl"
      className="w-full rounded-2xl border border-border bg-card/80 p-4 shadow-lg backdrop-blur-md"
    >
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <LayoutGrid className="h-4 w-4" />
        </span>
        الإحصاءات
      </div>

      <div className={cn("grid gap-2", cols)}>
        {stats.map((s, i) => {
          const up = s.trend === "up";
          const down = s.trend === "down";
          const sl = sel === i;
          return (
            <button
              key={i}
              onClick={() => setSel(sl ? null : i)}
              className={cn(
                "rounded-xl border p-3 text-right transition",
                sl
                  ? "border-primary/50 bg-primary/5"
                  : "border-border bg-background hover:bg-muted/50",
              )}
            >
              <div className="text-[11px] text-muted-foreground">{s.label}</div>
              <div className="mt-1 text-lg font-bold text-foreground">{s.value}</div>
              {s.delta && (
                <div
                  className={cn(
                    "mt-0.5 flex items-center gap-1 text-[11px] font-medium",
                    up && "text-emerald-500",
                    down && "text-rose-500",
                    !up && !down && "text-muted-foreground",
                  )}
                >
                  {up && <TrendingUp className="h-3 w-3" />}
                  {down && <TrendingDown className="h-3 w-3" />}
                  {s.delta}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {sel !== null && (
        <button
          onClick={() =>
            onAction?.("submit_prompt", {
              text: `فصّل مؤشّر «${stats[sel].label}» وقيمته ${stats[sel].value}${
                stats[sel].delta ? ` بتغيّر ${stats[sel].delta}` : ""
              }.`,
            })
          }
          className="mt-3 w-full rounded-xl bg-primary/10 py-2 text-sm font-medium text-primary transition hover:bg-primary/20"
        >
          تفصيل المؤشّر
        </button>
      )}
    </div>
  );
}

/* ============================================================
   39. timeline — خط زمني عمودي
   ============================================================ */

export function Timeline({
  events = [
    { time: "09:00", title: "فتح السوق", detail: "بداية الجلسة", tone: "info" },
    { time: "10:30", title: "اختراق مقاومة", detail: "حجم تداول مرتفع", tone: "up" },
    { time: "13:15", title: "تصحيح هابط", detail: "جني أرباح", tone: "down" },
    { time: "15:45", title: "إغلاق إيجابي", detail: "+1.8%", tone: "up" },
  ],
  onAction,
}: {
  events?: { time: string; title: string; detail?: string; tone?: "up" | "down" | "warn" | "info" }[];
  onAction?: ActionFn;
}) {
  const [open, setOpen] = useState<number | null>(0);

  const dotColor = (t?: string) =>
    t === "up"
      ? "bg-emerald-500"
      : t === "down"
        ? "bg-rose-500"
        : t === "warn"
          ? "bg-amber-500"
          : "bg-primary";

  return (
    <div
      dir="rtl"
      className="w-full rounded-2xl border border-border bg-card/80 p-4 shadow-lg backdrop-blur-md"
    >
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Clock className="h-4 w-4" />
        </span>
        الخط الزمني
      </div>

      <div className="relative ps-1">
        <div className="absolute bottom-2 right-[7px] top-2 w-px bg-border" />
        <div className="space-y-1">
          {events.map((ev, i) => {
            const isOpen = open === i;
            return (
              <div key={i} className="relative pr-6">
                <span
                  className={cn(
                    "absolute right-0 top-2 h-3.5 w-3.5 rounded-full ring-4 ring-card transition",
                    dotColor(ev.tone),
                    isOpen && "scale-125",
                  )}
                />
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className={cn(
                    "w-full rounded-xl p-2 text-right transition",
                    isOpen ? "bg-muted/60" : "hover:bg-muted/40",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">{ev.title}</span>
                    <span className="text-[11px] text-muted-foreground">{ev.time}</span>
                  </div>
                  {isOpen && ev.detail && (
                    <p className="mt-1 text-xs text-muted-foreground">{ev.detail}</p>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <button
        onClick={() => onAction?.("submit_prompt", { text: "لخّص أحداث هذا الخط الزمني." })}
        className="mt-3 w-full rounded-xl bg-muted py-1.5 text-xs font-medium text-foreground transition hover:bg-muted/70"
      >
        تلخيص الأحداث
      </button>
    </div>
  );
}

/* ============================================================
   40. kpi_card — مؤشّر أداء كبير
   ============================================================ */

export function KpiCard({
  label = "صافي الربح",
  value = "١٨٬٤٢٠",
  delta = "+12.4%",
  trend = "up",
  points = [10, 12, 9, 14, 13, 17, 16, 19, 18, 22],
  onAction,
}: {
  label?: string;
  value?: string | number;
  delta?: string;
  trend?: "up" | "down";
  points?: number[];
  onAction?: ActionFn;
}) {
  const [showSpark, setShowSpark] = useState<boolean>(true);
  const up = trend === "up";
  const tone = up ? "#10b981" : "#f43f5e";

  const w = 260;
  const h = 48;
  const data = points.length ? points : [0];
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const coords = data.map((v, i) => {
    const x = (i / (data.length - 1 || 1)) * w;
    const y = h - 4 - ((v - min) / span) * (h - 8);
    return `${i === 0 ? "M" : "L"} ${x} ${y}`;
  });
  const line = coords.join(" ");

  return (
    <div
      dir="rtl"
      className="w-full overflow-hidden rounded-2xl border border-border bg-card/80 p-4 shadow-lg backdrop-blur-md"
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="mt-1 text-3xl font-bold text-foreground">{value}</div>
          <div
            className={cn(
              "mt-1 flex items-center gap-1 text-sm font-semibold",
              up ? "text-emerald-500" : "text-rose-500",
            )}
          >
            {up ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            {delta}
          </div>
        </div>
        <button
          onClick={() => setShowSpark((s) => !s)}
          className={cn(
            "rounded-xl px-2.5 py-1 text-[11px] font-medium transition",
            showSpark ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          {showSpark ? "إخفاء الرسم" : "إظهار الرسم"}
        </button>
      </div>

      {showSpark && (
        <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 w-full">
          <defs>
            <linearGradient id="kpi-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={tone} stopOpacity="0.25" />
              <stop offset="100%" stopColor={tone} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${line} L ${w} ${h} L 0 ${h} Z`} fill="url(#kpi-fill)" />
          <path
            d={line}
            fill="none"
            stroke={tone}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}

      <button
        onClick={() =>
          onAction?.("submit_prompt", {
            text: `حلّل مؤشّر «${label}» الحالي وهو ${value} بتغيّر ${delta}.`,
          })
        }
        className="mt-3 w-full rounded-xl bg-primary/10 py-2 text-sm font-medium text-primary transition hover:bg-primary/20"
      >
        تحليل المؤشّر
      </button>
    </div>
  );
}

/* ============================================================
   41. donut — قرص عام
   ============================================================ */

export function Donut({
  slices = [
    { label: "أسهم", value: 45 },
    { label: "عملات", value: 25 },
    { label: "ذهب", value: 18 },
    { label: "نقد", value: 12 },
  ],
  onAction,
}: {
  slices?: { label: string; value: number }[];
  onAction?: ActionFn;
}) {
  const [active, setActive] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const cx = 80;
  const cy = 80;
  const r = 60;

  let acc = 0;
  const arcs = slices.map((s, i) => {
    const start = (acc / total) * 360;
    acc += s.value;
    const end = (acc / total) * 360;
    return { ...s, start, end, color: PALETTE[i % PALETTE.length], idx: i };
  });

  const focus = active !== null ? arcs[active] : null;

  return (
    <div
      dir="rtl"
      className="w-full rounded-2xl border border-border bg-card/80 p-4 shadow-lg backdrop-blur-md"
    >
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <PieChart className="h-4 w-4" />
        </span>
        التوزيع
      </div>

      <div className="flex items-center gap-4">
        <svg viewBox="0 0 160 160" className="h-40 w-40 shrink-0">
          {arcs.map((a) => {
            const isActive = active === a.idx;
            return (
              <path
                key={a.idx}
                d={describeArc(cx, cy, r, a.start, a.end)}
                fill="none"
                stroke={a.color}
                strokeWidth={isActive ? 26 : 20}
                onMouseEnter={() => setActive(a.idx)}
                onMouseLeave={() => setActive(null)}
                onClick={() => setActive(isActive ? null : a.idx)}
                className="cursor-pointer transition-all duration-200"
                style={{ filter: isActive ? `drop-shadow(0 0 6px ${a.color}88)` : "none" }}
              />
            );
          })}
          <text
            x={cx}
            y={cy - 4}
            textAnchor="middle"
            className="fill-foreground"
            fontSize="20"
            fontWeight="700"
          >
            {focus ? `${Math.round((focus.value / total) * 100)}%` : total}
          </text>
          <text
            x={cx}
            y={cy + 14}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize="9"
          >
            {focus ? focus.label : "الإجمالي"}
          </text>
        </svg>

        <div className="flex-1 space-y-1.5">
          {arcs.map((a) => (
            <button
              key={a.idx}
              onClick={() => setActive(active === a.idx ? null : a.idx)}
              className={cn(
                "flex w-full items-center justify-between rounded-lg px-2 py-1 text-right transition",
                active === a.idx ? "bg-muted/60" : "hover:bg-muted/40",
              )}
            >
              <span className="flex items-center gap-2 text-xs text-foreground">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: a.color }} />
                {a.label}
              </span>
              <span className="text-xs font-semibold text-muted-foreground">
                {Math.round((a.value / total) * 100)}%
              </span>
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={() =>
          onAction?.("submit_prompt", {
            text: focus
              ? `حلّل شريحة «${focus.label}» التي تمثّل ${Math.round((focus.value / total) * 100)}% من التوزيع.`
              : "حلّل توزيع هذا القرص بالكامل.",
          })
        }
        className="mt-3 w-full rounded-xl bg-primary/10 py-2 text-sm font-medium text-primary transition hover:bg-primary/20"
      >
        تحليل التوزيع
      </button>
    </div>
  );
}

/* ============================================================
   خريطة التصدير
   ============================================================ */

export const VIZ_WIDGETS = {
  gauge: Gauge,
  progress_ring: ProgressRing,
  sparkline: Sparkline,
  bar_compare: BarCompare,
  stat_grid: StatGrid,
  timeline: Timeline,
  kpi_card: KpiCard,
  donut: Donut,
};
