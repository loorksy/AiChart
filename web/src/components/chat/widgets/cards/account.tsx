"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Activity,
  ShieldAlert,
  PieChart,
  BarChart3,
  Gauge,
  X,
  ArrowUpRight,
  ArrowDownRight,
  LineChart,
} from "lucide-react";

type ActionFn = (action: string, payload: any) => void;

/* ------------------------------------------------------------------ */
/* أدوات مساعدة مشتركة                                                 */
/* ------------------------------------------------------------------ */

const fmt = (n: number, d = 2) =>
  Number.isFinite(n)
    ? n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })
    : "—";

function DeltaPill({ pct }: { pct?: number }) {
  if (pct == null) return null;
  const up = pct >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
        up
          ? "bg-emerald-500/15 text-emerald-500"
          : "bg-rose-500/15 text-rose-500"
      )}
    >
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {up ? "+" : ""}
      {fmt(pct, 2)}%
    </span>
  );
}

function CardShell({
  icon,
  title,
  subtitle,
  children,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      dir="rtl"
      className="w-full max-w-md rounded-2xl border border-border bg-card/80 p-4 shadow-lg backdrop-blur-md transition hover:shadow-xl"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {icon}
          </div>
          <div>
            <div className="text-sm font-bold text-foreground">{title}</div>
            {subtitle && (
              <div className="text-xs text-muted-foreground">{subtitle}</div>
            )}
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/* قرص مستوى الهامش (radial) مشترك */
function MarginRadial({ level, size = 120 }: { level: number; size?: number }) {
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  // نطاق التعبئة: 0..400% يُعتبر ممتلئاً
  const ratio = Math.max(0, Math.min(1, level / 400));
  const dash = c * ratio;
  const zone =
    level >= 200
      ? { stroke: "rgb(16 185 129)", label: "آمن" }
      : level >= 100
      ? { stroke: "rgb(245 158 11)", label: "حذر" }
      : { stroke: "rgb(244 63 94)", label: "خطر" };
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={9}
          className="text-muted/30"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={zone.stroke}
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          style={{ transition: "stroke-dasharray .6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-lg font-extrabold text-foreground">
          {fmt(level, 0)}%
        </div>
        <div
          className="text-[11px] font-semibold"
          style={{ color: zone.stroke }}
        >
          {zone.label}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 26. account_overview                                               */
/* ------------------------------------------------------------------ */

export function AccountOverview({
  balance = 0,
  equity = 0,
  margin = 0,
  freeMargin = 0,
  marginLevel = 0,
  onAction,
}: {
  balance?: number;
  equity?: number;
  margin?: number;
  freeMargin?: number;
  marginLevel?: number;
  onAction?: ActionFn;
}) {
  const [tab, setTab] = useState<"summary" | "margin">("summary");
  const rows = [
    { label: "الرصيد", value: balance, key: "b" },
    { label: "الإنصاف", value: equity, key: "e" },
    { label: "الهامش المستخدم", value: margin, key: "m" },
    { label: "الهامش الحر", value: freeMargin, key: "f" },
  ];
  return (
    <CardShell
      icon={<Wallet className="h-5 w-5" />}
      title="نظرة على الحساب"
      subtitle="ملخّص لحظي"
      action={
        <div className="flex rounded-xl bg-muted p-0.5 text-xs">
          {(["summary", "margin"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-lg px-2.5 py-1 font-semibold transition",
                tab === t
                  ? "bg-card text-foreground shadow"
                  : "text-muted-foreground"
              )}
            >
              {t === "summary" ? "ملخّص" : "هامش"}
            </button>
          ))}
        </div>
      }
    >
      {tab === "summary" ? (
        <div className="grid grid-cols-2 gap-2">
          {rows.map((r) => (
            <div
              key={r.key}
              className="rounded-xl border border-border bg-background/60 p-3"
            >
              <div className="text-xs text-muted-foreground">{r.label}</div>
              <div className="mt-1 text-base font-bold text-foreground">
                {fmt(r.value)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center gap-4">
          <MarginRadial level={marginLevel} />
          <div className="space-y-1 text-sm">
            <div className="text-muted-foreground">مستوى الهامش</div>
            <div className="text-2xl font-extrabold text-foreground">
              {fmt(marginLevel, 0)}%
            </div>
            <div className="text-xs text-muted-foreground">
              الحر: {fmt(freeMargin)}
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          onClick={() =>
            onAction?.("submit_prompt", { text: "اعرض لي صفقاتي المفتوحة الآن" })
          }
          className="flex items-center justify-center gap-1.5 rounded-xl bg-primary/10 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20"
        >
          <Activity className="h-4 w-4" /> صفقاتي
        </button>
        <button
          onClick={() =>
            onAction?.("submit_prompt", { text: "اعرض لي حالة المخاطر في حسابي" })
          }
          className="flex items-center justify-center gap-1.5 rounded-xl bg-amber-500/10 py-2 text-sm font-semibold text-amber-500 transition hover:bg-amber-500/20"
        >
          <ShieldAlert className="h-4 w-4" /> المخاطر
        </button>
      </div>
    </CardShell>
  );
}

/* ------------------------------------------------------------------ */
/* 27. equity_sparkline                                               */
/* ------------------------------------------------------------------ */

export function EquitySparkline({
  points = [],
  changePct,
  onAction,
}: {
  points?: number[];
  changePct?: number;
  onAction?: ActionFn;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const data = points.length ? points : [0];
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const W = 320;
  const H = 80;
  const stepX = data.length > 1 ? W / (data.length - 1) : W;
  const coords = data.map((v, i) => ({
    x: i * stepX,
    y: H - ((v - min) / span) * (H - 10) - 5,
    v,
  }));
  const path = coords
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const area = `${path} L${W},${H} L0,${H} Z`;
  const up = (changePct ?? 0) >= 0;
  const color = up ? "rgb(16 185 129)" : "rgb(244 63 94)";
  const active = hover != null ? coords[hover] : coords[coords.length - 1];
  return (
    <CardShell
      icon={<LineChart className="h-5 w-5" />}
      title="منحنى الإنصاف"
      subtitle="آخر فترة"
      action={<DeltaPill pct={changePct} />}
    >
      <div className="rounded-xl border border-border bg-background/60 p-3">
        <div className="mb-1 text-lg font-extrabold text-foreground">
          {fmt(active?.v ?? 0)}
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          preserveAspectRatio="none"
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="eqgrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#eqgrad)" />
          <path
            d={path}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {coords.map((p, i) => (
            <rect
              key={i}
              x={p.x - stepX / 2}
              y={0}
              width={stepX}
              height={H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
          {active && (
            <circle cx={active.x} cy={active.y} r={3.5} fill={color} />
          )}
        </svg>
      </div>
      <button
        onClick={() =>
          onAction?.("submit_prompt", {
            text: "حلّل لي أداء منحنى الإنصاف لحسابي",
          })
        }
        className="mt-3 w-full rounded-xl bg-muted py-2 text-sm font-semibold text-foreground transition hover:bg-muted/70"
      >
        تحليل الأداء
      </button>
    </CardShell>
  );
}

/* ------------------------------------------------------------------ */
/* 28. positions_table                                                */
/* ------------------------------------------------------------------ */

export function PositionsTable({
  positions = [],
  onAction,
}: {
  positions?: {
    symbol: string;
    side: "buy" | "sell" | string;
    size: number;
    pnl: number;
    tradeId: string;
  }[];
  onAction?: ActionFn;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <CardShell
      icon={<Activity className="h-5 w-5" />}
      title="المراكز المفتوحة"
      subtitle={`${positions.length} مركز`}
    >
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="grid grid-cols-[1.4fr_0.8fr_0.8fr_1fr_auto] gap-2 bg-muted px-3 py-2 text-[11px] font-semibold text-muted-foreground">
          <span>الرمز</span>
          <span>الجهة</span>
          <span>الحجم</span>
          <span>الربح</span>
          <span />
        </div>
        <div className="divide-y divide-border">
          {positions.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              لا توجد مراكز مفتوحة
            </div>
          )}
          {positions.map((p) => {
            const buy = p.side === "buy";
            const win = p.pnl >= 0;
            return (
              <div
                key={p.tradeId}
                className="grid grid-cols-[1.4fr_0.8fr_0.8fr_1fr_auto] items-center gap-2 px-3 py-2 text-sm"
              >
                <span className="font-bold text-foreground">{p.symbol}</span>
                <span
                  className={cn(
                    "inline-flex w-fit items-center rounded-md px-1.5 py-0.5 text-[11px] font-bold",
                    buy
                      ? "bg-emerald-500/15 text-emerald-500"
                      : "bg-rose-500/15 text-rose-500"
                  )}
                >
                  {buy ? "شراء" : "بيع"}
                </span>
                <span className="text-foreground">{fmt(p.size)}</span>
                <span
                  className={cn(
                    "font-semibold",
                    win ? "text-emerald-500" : "text-rose-500"
                  )}
                >
                  {win ? "+" : ""}
                  {fmt(p.pnl)}
                </span>
                {confirm === p.tradeId ? (
                  <button
                    onClick={() => {
                      onAction?.("execute_trade", { intentId: p.tradeId });
                      setConfirm(null);
                    }}
                    className="rounded-lg bg-rose-500 px-2 py-1 text-[11px] font-bold text-white transition hover:bg-rose-600"
                  >
                    تأكيد
                  </button>
                ) : (
                  <button
                    onClick={() => setConfirm(p.tradeId)}
                    className="flex items-center justify-center rounded-lg bg-rose-500/10 p-1.5 text-rose-500 transition hover:bg-rose-500/20"
                    aria-label="إغلاق"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </CardShell>
  );
}

/* ------------------------------------------------------------------ */
/* 29. pnl_summary                                                    */
/* ------------------------------------------------------------------ */

export function PnlSummary({
  realized = 0,
  unrealized = 0,
  todayPct,
  onAction,
}: {
  realized?: number;
  unrealized?: number;
  todayPct?: number;
  onAction?: ActionFn;
}) {
  const total = realized + unrealized;
  const cards = [
    { label: "محقّق", value: realized },
    { label: "غير محقّق", value: unrealized },
    { label: "الإجمالي", value: total },
  ];
  return (
    <CardShell
      icon={total >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
      title="ملخّص الربح والخسارة"
      subtitle="الجلسة الحالية"
      action={<DeltaPill pct={todayPct} />}
    >
      <div className="grid grid-cols-3 gap-2">
        {cards.map((c) => {
          const win = c.value >= 0;
          return (
            <div
              key={c.label}
              className={cn(
                "rounded-xl border p-3 text-center",
                win
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-rose-500/30 bg-rose-500/5"
              )}
            >
              <div className="text-[11px] text-muted-foreground">{c.label}</div>
              <div
                className={cn(
                  "mt-1 text-base font-extrabold",
                  win ? "text-emerald-500" : "text-rose-500"
                )}
              >
                {win ? "+" : ""}
                {fmt(c.value)}
              </div>
            </div>
          );
        })}
      </div>
      <button
        onClick={() =>
          onAction?.("submit_prompt", {
            text: "اعرض لي تفاصيل الأرباح والخسائر لكل صفقة",
          })
        }
        className="mt-3 w-full rounded-xl bg-muted py-2 text-sm font-semibold text-foreground transition hover:bg-muted/70"
      >
        تفاصيل الصفقات
      </button>
    </CardShell>
  );
}

/* ------------------------------------------------------------------ */
/* 30. margin_gauge                                                   */
/* ------------------------------------------------------------------ */

export function MarginGauge({
  marginLevel = 0,
  onAction,
}: {
  marginLevel?: number;
  onAction?: ActionFn;
}) {
  return (
    <CardShell
      icon={<Gauge className="h-5 w-5" />}
      title="مستوى الهامش"
      subtitle="مع مناطق الخطر"
    >
      <div className="flex items-center justify-center gap-5 py-2">
        <MarginRadial level={marginLevel} size={140} />
        <div className="space-y-2 text-xs">
          {[
            { c: "rgb(16 185 129)", t: "آمن ≥ 200%" },
            { c: "rgb(245 158 11)", t: "حذر 100–200%" },
            { c: "rgb(244 63 94)", t: "خطر < 100%" },
          ].map((z) => (
            <div key={z.t} className="flex items-center gap-2">
              <span
                className="h-3 w-3 rounded-full"
                style={{ background: z.c }}
              />
              <span className="text-muted-foreground">{z.t}</span>
            </div>
          ))}
        </div>
      </div>
      {marginLevel < 100 && (
        <button
          onClick={() =>
            onAction?.("submit_prompt", {
              text: "مستوى الهامش منخفض، اقترح لي خطة لتقليل المخاطر",
            })
          }
          className="mt-2 w-full rounded-xl bg-rose-500/10 py-2 text-sm font-semibold text-rose-500 transition hover:bg-rose-500/20"
        >
          خطّة لتقليل المخاطر
        </button>
      )}
    </CardShell>
  );
}

/* ------------------------------------------------------------------ */
/* 31. allocation_donut                                               */
/* ------------------------------------------------------------------ */

const DONUT_COLORS = [
  "rgb(16 185 129)",
  "rgb(59 130 246)",
  "rgb(245 158 11)",
  "rgb(168 85 247)",
  "rgb(244 63 94)",
  "rgb(20 184 166)",
];

export function AllocationDonut({
  slices = [],
  onAction,
}: {
  slices?: { label: string; value: number }[];
  onAction?: ActionFn;
}) {
  const [active, setActive] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const size = 140;
  const r = 55;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const segs = slices.map((s, i) => {
    const frac = s.value / total;
    const seg = {
      ...s,
      i,
      dash: frac * c,
      gap: c - frac * c,
      rot: (offset / total) * 360,
      pct: frac * 100,
    };
    offset += s.value;
    return seg;
  });
  return (
    <CardShell
      icon={<PieChart className="h-5 w-5" />}
      title="توزيع الأصول"
      subtitle="حسب القيمة"
    >
      <div className="flex items-center justify-center gap-5">
        <div className="relative" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            {segs.map((s) => (
              <circle
                key={s.i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={DONUT_COLORS[s.i % DONUT_COLORS.length]}
                strokeWidth={active === s.i ? 20 : 14}
                strokeDasharray={`${s.dash} ${s.gap}`}
                strokeDashoffset={-((s.rot / 360) * c)}
                style={{ transition: "stroke-width .2s" }}
                onMouseEnter={() => setActive(s.i)}
                onMouseLeave={() => setActive(null)}
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            {active != null ? (
              <>
                <div className="text-xs text-muted-foreground">
                  {segs[active].label}
                </div>
                <div className="text-lg font-extrabold text-foreground">
                  {fmt(segs[active].pct, 0)}%
                </div>
              </>
            ) : (
              <>
                <div className="text-xs text-muted-foreground">الإجمالي</div>
                <div className="text-base font-extrabold text-foreground">
                  {fmt(total)}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          {segs.map((s) => (
            <button
              key={s.i}
              onMouseEnter={() => setActive(s.i)}
              onMouseLeave={() => setActive(null)}
              className="flex w-full items-center gap-2 text-xs"
            >
              <span
                className="h-3 w-3 rounded-full"
                style={{ background: DONUT_COLORS[s.i % DONUT_COLORS.length] }}
              />
              <span className="text-foreground">{s.label}</span>
              <span className="text-muted-foreground">
                {fmt(s.pct, 0)}%
              </span>
            </button>
          ))}
        </div>
      </div>
    </CardShell>
  );
}

/* ------------------------------------------------------------------ */
/* 32. exposure_bars                                                  */
/* ------------------------------------------------------------------ */

export function ExposureBars({
  longPct = 0,
  shortPct = 0,
  onAction,
}: {
  longPct?: number;
  shortPct?: number;
  onAction?: ActionFn;
}) {
  const sum = longPct + shortPct || 1;
  const l = (longPct / sum) * 100;
  const s = (shortPct / sum) * 100;
  return (
    <CardShell
      icon={<BarChart3 className="h-5 w-5" />}
      title="التعرّض في السوق"
      subtitle="شراء مقابل بيع"
    >
      <div className="space-y-3">
        <div>
          <div className="mb-1 flex justify-between text-xs">
            <span className="font-semibold text-emerald-500">شراء</span>
            <span className="text-muted-foreground">{fmt(longPct, 0)}%</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${l}%` }}
            />
          </div>
        </div>
        <div>
          <div className="mb-1 flex justify-between text-xs">
            <span className="font-semibold text-rose-500">بيع</span>
            <span className="text-muted-foreground">{fmt(shortPct, 0)}%</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-rose-500 transition-all duration-500"
              style={{ width: `${s}%` }}
            />
          </div>
        </div>
      </div>
      <div className="mt-3 flex overflow-hidden rounded-full text-center text-[11px] font-bold text-white">
        <div
          className="bg-emerald-500 py-1"
          style={{ width: `${l}%` }}
        >
          {l > 12 ? `${fmt(l, 0)}%` : ""}
        </div>
        <div className="bg-rose-500 py-1" style={{ width: `${s}%` }}>
          {s > 12 ? `${fmt(s, 0)}%` : ""}
        </div>
      </div>
      <button
        onClick={() =>
          onAction?.("submit_prompt", {
            text: "هل تعرّضي في السوق متوازن؟ راجع توزيع الشراء والبيع",
          })
        }
        className="mt-3 w-full rounded-xl bg-muted py-2 text-sm font-semibold text-foreground transition hover:bg-muted/70"
      >
        مراجعة التوازن
      </button>
    </CardShell>
  );
}

/* ------------------------------------------------------------------ */
/* 33. balance_card                                                   */
/* ------------------------------------------------------------------ */

export function BalanceCard({
  label = "الرصيد",
  value = 0,
  changePct,
  trend,
  onAction,
}: {
  label?: string;
  value?: number;
  changePct?: number;
  trend?: "up" | "down" | string;
  onAction?: ActionFn;
}) {
  const dir =
    trend === "up" ? 1 : trend === "down" ? -1 : (changePct ?? 0) >= 0 ? 1 : -1;
  const up = dir > 0;
  return (
    <CardShell
      icon={<Wallet className="h-5 w-5" />}
      title={label}
      action={<DeltaPill pct={changePct} />}
    >
      <div
        className={cn(
          "rounded-2xl border p-5 text-center",
          up
            ? "border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-transparent"
            : "border-rose-500/30 bg-gradient-to-br from-rose-500/10 to-transparent"
        )}
      >
        <div className="text-3xl font-extrabold tracking-tight text-foreground">
          {fmt(value)}
        </div>
        <div
          className={cn(
            "mt-1 inline-flex items-center gap-1 text-sm font-semibold",
            up ? "text-emerald-500" : "text-rose-500"
          )}
        >
          {up ? (
            <TrendingUp className="h-4 w-4" />
          ) : (
            <TrendingDown className="h-4 w-4" />
          )}
          {changePct != null ? `${up ? "+" : ""}${fmt(changePct, 2)}%` : up ? "صاعد" : "هابط"}
        </div>
      </div>
      <button
        onClick={() =>
          onAction?.("inject_input", { text: `تفاصيل ${label}: ` })
        }
        className="mt-3 w-full rounded-xl bg-muted py-2 text-sm font-semibold text-foreground transition hover:bg-muted/70"
      >
        إضافة ملاحظة
      </button>
    </CardShell>
  );
}

/* ------------------------------------------------------------------ */
/* خريطة التصدير                                                       */
/* ------------------------------------------------------------------ */

export const ACCOUNT_WIDGETS = {
  account_overview: AccountOverview,
  equity_sparkline: EquitySparkline,
  positions_table: PositionsTable,
  pnl_summary: PnlSummary,
  margin_gauge: MarginGauge,
  allocation_donut: AllocationDonut,
  exposure_bars: ExposureBars,
  balance_card: BalanceCard,
};
