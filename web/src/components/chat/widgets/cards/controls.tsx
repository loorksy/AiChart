"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Clock,
  ArrowLeftRight,
  Settings2,
  Target,
  CheckCircle2,
  Circle,
  ListChecks,
  Gauge,
  Newspaper,
  Info,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Zap,
  TrendingUp,
  TrendingDown,
  Minus,
  Bitcoin,
  DollarSign,
  X,
  ChevronRight,
} from "lucide-react";

type OnAction = (action: string, payload: any) => void;

// ---------------------------------------------------------------------------
// 42. timeframe_picker
// ---------------------------------------------------------------------------
export function TimeframePicker({
  symbol,
  active,
  onAction,
}: {
  symbol?: string;
  active?: string;
  onAction?: OnAction;
}) {
  const frames = ["15m", "1h", "4h", "1d"];
  const [sel, setSel] = useState<string>(active ?? "1h");

  const pick = (tf: string) => {
    setSel(tf);
    const sym = symbol ? ` لـ ${symbol}` : "";
    onAction?.("submit_prompt", {
      text: `حلّل الإطار الزمني ${tf}${sym} وأعطني نظرتك.`,
    });
  };

  return (
    <div
      dir="rtl"
      className="rounded-2xl border border-border bg-card p-4 shadow-lg backdrop-blur-md"
    >
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Clock className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">الإطار الزمني</p>
          {symbol ? (
            <p className="text-xs text-muted-foreground">{symbol}</p>
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {frames.map((tf) => (
          <button
            key={tf}
            onClick={() => pick(tf)}
            className={cn(
              "rounded-xl border px-2 py-2 text-sm font-medium transition-all",
              sel === tf
                ? "border-primary bg-primary/15 text-primary shadow-[0_0_12px_-2px] shadow-primary/40"
                : "border-border bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            )}
          >
            {tf}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 43. market_switch
// ---------------------------------------------------------------------------
export function MarketSwitch({
  active,
  onAction,
}: {
  active?: "crypto" | "forex";
  onAction?: OnAction;
}) {
  const [sel, setSel] = useState<"crypto" | "forex">(active ?? "crypto");

  const pick = (m: "crypto" | "forex") => {
    setSel(m);
    onAction?.("submit_prompt", {
      text:
        m === "crypto"
          ? "بدّل السوق إلى الكريبتو."
          : "بدّل السوق إلى الفوركس.",
    });
  };

  const opts: { key: "crypto" | "forex"; label: string; icon: any }[] = [
    { key: "crypto", label: "كريبتو", icon: Bitcoin },
    { key: "forex", label: "فوركس", icon: DollarSign },
  ];

  return (
    <div
      dir="rtl"
      className="rounded-2xl border border-border bg-card p-4 shadow-lg backdrop-blur-md"
    >
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ArrowLeftRight className="h-4 w-4" />
        </div>
        <p className="text-sm font-semibold text-foreground">نوع السوق</p>
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
        {opts.map((o) => {
          const Icon = o.icon;
          const isOn = sel === o.key;
          return (
            <button
              key={o.key}
              onClick={() => pick(o.key)}
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all",
                isOn
                  ? "bg-card text-foreground shadow-md"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 44. mode_switch
// ---------------------------------------------------------------------------
export function ModeSwitch({
  active,
  onAction,
}: {
  active?: "auto" | "approval" | "live";
  onAction?: OnAction;
}) {
  const [sel, setSel] = useState<"auto" | "approval" | "live">(
    active ?? "approval"
  );

  const opts: {
    key: "auto" | "approval" | "live";
    label: string;
    desc: string;
    color: string;
  }[] = [
    {
      key: "auto",
      label: "تلقائي",
      desc: "ينفّذ دون سؤال",
      color: "emerald",
    },
    {
      key: "approval",
      label: "موافقة",
      desc: "يطلب إذنك أولاً",
      color: "amber",
    },
    {
      key: "live",
      label: "مباشر",
      desc: "تنفيذ فوري حيّ",
      color: "rose",
    },
  ];

  const pick = (k: "auto" | "approval" | "live") => {
    setSel(k);
    const label = opts.find((o) => o.key === k)?.label ?? k;
    onAction?.("submit_prompt", {
      text: `غيّر وضع التنفيذ إلى الوضع ${label}.`,
    });
  };

  return (
    <div
      dir="rtl"
      className="rounded-2xl border border-border bg-card p-4 shadow-lg backdrop-blur-md"
    >
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Settings2 className="h-4 w-4" />
        </div>
        <p className="text-sm font-semibold text-foreground">وضع التنفيذ</p>
      </div>
      <div className="space-y-2">
        {opts.map((o) => {
          const isOn = sel === o.key;
          return (
            <button
              key={o.key}
              onClick={() => pick(o.key)}
              className={cn(
                "flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-right transition-all",
                isOn
                  ? o.color === "emerald"
                    ? "border-emerald-500/50 bg-emerald-500/10"
                    : o.color === "rose"
                    ? "border-rose-500/50 bg-rose-500/10"
                    : "border-amber-500/50 bg-amber-500/10"
                  : "border-border bg-muted hover:bg-muted/70"
              )}
            >
              <div>
                <p
                  className={cn(
                    "text-sm font-medium",
                    isOn
                      ? o.color === "emerald"
                        ? "text-emerald-500"
                        : o.color === "rose"
                        ? "text-rose-500"
                        : "text-amber-500"
                      : "text-foreground"
                  )}
                >
                  {o.label}
                </p>
                <p className="text-xs text-muted-foreground">{o.desc}</p>
              </div>
              <div
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all",
                  isOn
                    ? o.color === "emerald"
                      ? "border-emerald-500"
                      : o.color === "rose"
                      ? "border-rose-500"
                      : "border-amber-500"
                    : "border-border"
                )}
              >
                {isOn ? (
                  <div
                    className={cn(
                      "h-2.5 w-2.5 rounded-full",
                      o.color === "emerald"
                        ? "bg-emerald-500"
                        : o.color === "rose"
                        ? "bg-rose-500"
                        : "bg-amber-500"
                    )}
                  />
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 45. strategy_picker
// ---------------------------------------------------------------------------
export function StrategyPicker({
  active,
  onAction,
}: {
  active?: string;
  onAction?: OnAction;
}) {
  const opts: { key: string; label: string; desc: string }[] = [
    { key: "scalp", label: "سكالب", desc: "صفقات سريعة جداً" },
    { key: "day", label: "يومي", desc: "خلال اليوم" },
    { key: "swing", label: "تأرجحي", desc: "أيام إلى أسابيع" },
    { key: "invest", label: "استثماري", desc: "مدى طويل" },
  ];
  const [sel, setSel] = useState<string>(active ?? "day");

  const pick = (k: string) => {
    setSel(k);
    const label = opts.find((o) => o.key === k)?.label ?? k;
    onAction?.("submit_prompt", {
      text: `اعتمد الأسلوب ${label} في التحليل والتنفيذ.`,
    });
  };

  return (
    <div
      dir="rtl"
      className="rounded-2xl border border-border bg-card p-4 shadow-lg backdrop-blur-md"
    >
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Target className="h-4 w-4" />
        </div>
        <p className="text-sm font-semibold text-foreground">أسلوب التداول</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {opts.map((o) => {
          const isOn = sel === o.key;
          return (
            <button
              key={o.key}
              onClick={() => pick(o.key)}
              className={cn(
                "rounded-xl border p-3 text-right transition-all",
                isOn
                  ? "border-primary bg-primary/10 shadow-[0_0_14px_-4px] shadow-primary/40"
                  : "border-border bg-muted hover:bg-muted/70"
              )}
            >
              <p
                className={cn(
                  "text-sm font-semibold",
                  isOn ? "text-primary" : "text-foreground"
                )}
              >
                {o.label}
              </p>
              <p className="text-xs text-muted-foreground">{o.desc}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 46. checklist
// ---------------------------------------------------------------------------
export function Checklist({
  items,
  onAction,
}: {
  items?: { label: string; done?: boolean }[];
  onAction?: OnAction;
}) {
  const initial = (items ?? [
    { label: "تحديد الاتجاه العام", done: true },
    { label: "رصد مستويات الدعم والمقاومة", done: false },
    { label: "تأكيد الإشارة من المؤشرات", done: false },
    { label: "ضبط وقف الخسارة والهدف", done: false },
  ]).map((it) => ({ label: it.label, done: !!it.done }));

  const [list, setList] = useState(initial);
  const doneCount = list.filter((i) => i.done).length;
  const pct = list.length ? Math.round((doneCount / list.length) * 100) : 0;

  const toggle = (idx: number) => {
    setList((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, done: !it.done } : it))
    );
  };

  return (
    <div
      dir="rtl"
      className="rounded-2xl border border-border bg-card p-4 shadow-lg backdrop-blur-md"
    >
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ListChecks className="h-4 w-4" />
        </div>
        <p className="flex-1 text-sm font-semibold text-foreground">
          قائمة التحقّق
        </p>
        <span className="text-xs font-medium text-muted-foreground">
          {doneCount}/{list.length}
        </span>
      </div>

      <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="space-y-1.5">
        {list.map((it, idx) => (
          <button
            key={idx}
            onClick={() => toggle(idx)}
            className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-right transition-colors hover:bg-muted"
          >
            {it.done ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
            ) : (
              <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />
            )}
            <span
              className={cn(
                "text-sm",
                it.done
                  ? "text-muted-foreground line-through"
                  : "text-foreground"
              )}
            >
              {it.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 47. step_progress
// ---------------------------------------------------------------------------
export function StepProgress({
  steps,
  current,
}: {
  steps?: string[];
  current?: number;
}) {
  const list = steps ?? ["تحليل", "إشارة", "موافقة", "تنفيذ"];
  const cur = typeof current === "number" ? current : 1;

  return (
    <div
      dir="rtl"
      className="rounded-2xl border border-border bg-card p-4 shadow-lg backdrop-blur-md"
    >
      <p className="mb-4 text-sm font-semibold text-foreground">سير العملية</p>
      <div className="flex items-center">
        {list.map((s, idx) => {
          const isDone = idx < cur;
          const isCur = idx === cur;
          return (
            <div key={idx} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold transition-all",
                    isDone
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : isCur
                      ? "border-primary bg-primary/15 text-primary shadow-[0_0_12px_-2px] shadow-primary/50"
                      : "border-border bg-muted text-muted-foreground"
                  )}
                >
                  {isDone ? <CheckCircle className="h-4 w-4" /> : idx + 1}
                </div>
                <span
                  className={cn(
                    "max-w-[64px] text-center text-[11px] leading-tight",
                    isCur
                      ? "font-medium text-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  {s}
                </span>
              </div>
              {idx < list.length - 1 ? (
                <div className="mx-1 h-0.5 flex-1 rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      idx < cur ? "w-full bg-emerald-500" : "w-0"
                    )}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 48. fear_greed
// ---------------------------------------------------------------------------
export function FearGreed({ value }: { value?: number }) {
  const v = Math.max(0, Math.min(100, typeof value === "number" ? value : 50));

  let label = "محايد";
  let color = "#f59e0b";
  if (v < 25) {
    label = "خوف شديد";
    color = "#f43f5e";
  } else if (v < 45) {
    label = "خوف";
    color = "#fb923c";
  } else if (v < 55) {
    label = "محايد";
    color = "#f59e0b";
  } else if (v < 75) {
    label = "طمع";
    color = "#84cc16";
  } else {
    label = "طمع شديد";
    color = "#10b981";
  }

  // semicircle gauge geometry
  const cx = 100;
  const cy = 100;
  const r = 80;
  const angle = Math.PI * (1 - v / 100); // 180deg(left) -> 0deg(right)
  const nx = cx + r * Math.cos(angle);
  const ny = cy - r * Math.sin(angle);

  const arc = (start: number, end: number) => {
    const a0 = Math.PI * (1 - start / 100);
    const a1 = Math.PI * (1 - end / 100);
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy - r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy - r * Math.sin(a1);
    return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
  };

  return (
    <div
      dir="rtl"
      className="rounded-2xl border border-border bg-card p-4 shadow-lg backdrop-blur-md"
    >
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Gauge className="h-4 w-4" />
        </div>
        <p className="text-sm font-semibold text-foreground">
          مؤشّر الخوف والطمع
        </p>
      </div>

      <div className="flex flex-col items-center">
        <svg viewBox="0 0 200 120" className="w-full max-w-[260px]">
          <path
            d={arc(0, 100)}
            fill="none"
            stroke="currentColor"
            className="text-muted"
            strokeWidth={14}
            strokeLinecap="round"
          />
          <path
            d={arc(0, v)}
            fill="none"
            stroke={color}
            strokeWidth={14}
            strokeLinecap="round"
          />
          <line
            x1={cx}
            y1={cy}
            x2={nx}
            y2={ny}
            stroke="currentColor"
            className="text-foreground"
            strokeWidth={3}
            strokeLinecap="round"
          />
          <circle cx={cx} cy={cy} r={5} className="fill-foreground" />
        </svg>
        <div className="-mt-4 text-center">
          <p className="text-3xl font-bold" style={{ color }}>
            {v}
          </p>
          <p className="text-sm font-medium" style={{ color }}>
            {label}
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 49. news_feed
// ---------------------------------------------------------------------------
export function NewsFeed({
  items,
  onAction,
}: {
  items?: { title: string; source?: string; sentiment?: string }[];
  onAction?: OnAction;
}) {
  const list = items ?? [
    {
      title: "البيتكوين يخترق مستوى مقاومة رئيسي",
      source: "كوين ديسك",
      sentiment: "positive",
    },
    {
      title: "بيانات التضخم الأمريكية أعلى من المتوقع",
      source: "رويترز",
      sentiment: "negative",
    },
    {
      title: "البنك المركزي يبقي الفائدة دون تغيير",
      source: "بلومبرغ",
      sentiment: "neutral",
    },
  ];

  const tone = (s?: string) => {
    if (s === "positive")
      return { Icon: TrendingUp, cls: "text-emerald-500 bg-emerald-500/10" };
    if (s === "negative")
      return { Icon: TrendingDown, cls: "text-rose-500 bg-rose-500/10" };
    return { Icon: Minus, cls: "text-muted-foreground bg-muted" };
  };

  return (
    <div
      dir="rtl"
      className="rounded-2xl border border-border bg-card p-4 shadow-lg backdrop-blur-md"
    >
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Newspaper className="h-4 w-4" />
        </div>
        <p className="text-sm font-semibold text-foreground">آخر الأخبار</p>
      </div>
      <div className="space-y-2">
        {list.map((n, idx) => {
          const { Icon, cls } = tone(n.sentiment);
          return (
            <button
              key={idx}
              onClick={() =>
                onAction?.("submit_prompt", {
                  text: `حلّل أثر هذا الخبر على السوق: «${n.title}».`,
                })
              }
              className="flex w-full items-start gap-2.5 rounded-xl border border-border bg-muted/50 p-2.5 text-right transition-colors hover:bg-muted"
            >
              <div
                className={cn(
                  "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                  cls
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-medium text-foreground">
                  {n.title}
                </p>
                {n.source ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {n.source}
                  </p>
                ) : null}
              </div>
              <ChevronRight className="mt-1.5 h-4 w-4 shrink-0 rotate-180 text-muted-foreground" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 50. alert_banner
// ---------------------------------------------------------------------------
export function AlertBanner({
  type,
  title,
  text,
}: {
  type?: "success" | "warning" | "info" | "danger";
  title?: string;
  text?: string;
}) {
  const [open, setOpen] = useState(true);
  const t = type ?? "info";

  const map = {
    success: {
      Icon: CheckCircle,
      cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      iconCls: "text-emerald-500",
    },
    warning: {
      Icon: AlertTriangle,
      cls: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
      iconCls: "text-amber-500",
    },
    info: {
      Icon: Info,
      cls: "border-primary/40 bg-primary/10 text-primary",
      iconCls: "text-primary",
    },
    danger: {
      Icon: XCircle,
      cls: "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400",
      iconCls: "text-rose-500",
    },
  } as const;

  const { Icon, cls, iconCls } = map[t];

  if (!open) return null;

  return (
    <div
      dir="rtl"
      className={cn(
        "flex items-start gap-3 rounded-2xl border p-4 shadow-lg backdrop-blur-md",
        cls
      )}
    >
      <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", iconCls)} />
      <div className="min-w-0 flex-1">
        {title ? (
          <p className="text-sm font-semibold text-foreground">{title}</p>
        ) : null}
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
      <button
        onClick={() => setOpen(false)}
        className="shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-background/50 hover:text-foreground"
        aria-label="إغلاق"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 51. confirm_dialog
// ---------------------------------------------------------------------------
export function ConfirmDialog({
  question,
  confirmText,
  cancelText,
  confirmPrompt,
  onAction,
}: {
  question?: string;
  confirmText?: string;
  cancelText?: string;
  confirmPrompt?: string;
  onAction?: OnAction;
}) {
  const [resolved, setResolved] = useState<null | "yes" | "no">(null);

  const q = question ?? "هل تريد المتابعة؟";
  const yes = confirmText ?? "نعم، تابع";
  const no = cancelText ?? "إلغاء";

  const onYes = () => {
    setResolved("yes");
    onAction?.("submit_prompt", {
      text: confirmPrompt ?? "نعم، أكّد العملية وتابع.",
    });
  };
  const onNo = () => {
    setResolved("no");
    onAction?.("submit_prompt", { text: "لا، ألغِ العملية." });
  };

  return (
    <div
      dir="rtl"
      className="rounded-2xl border border-border bg-card p-4 shadow-lg backdrop-blur-md"
    >
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <p className="pt-1 text-sm font-medium text-foreground">{q}</p>
      </div>

      {resolved ? (
        <div
          className={cn(
            "rounded-xl border px-3 py-2.5 text-center text-sm font-medium",
            resolved === "yes"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
              : "border-rose-500/40 bg-rose-500/10 text-rose-500"
          )}
        >
          {resolved === "yes" ? `تم: ${yes}` : `تم: ${no}`}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onYes}
            className="rounded-xl bg-emerald-500 px-3 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:bg-emerald-600 hover:shadow-[0_0_16px_-4px] hover:shadow-emerald-500/60"
          >
            {yes}
          </button>
          <button
            onClick={onNo}
            className="rounded-xl border border-border bg-muted px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/70"
          >
            {no}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 52. quick_actions
// ---------------------------------------------------------------------------
const ICONS: Record<string, any> = {
  zap: Zap,
  target: Target,
  clock: Clock,
  news: Newspaper,
  up: TrendingUp,
  down: TrendingDown,
  gauge: Gauge,
  settings: Settings2,
};

export function QuickActions({
  actions,
  onAction,
}: {
  actions?: { label: string; prompt: string; icon?: string }[];
  onAction?: OnAction;
}) {
  const list = actions ?? [
    { label: "حلّل السوق", prompt: "أعطني نظرة عامة سريعة على السوق الآن.", icon: "gauge" },
    { label: "أفضل فرصة", prompt: "ما أفضل فرصة تداول متاحة حالياً؟", icon: "target" },
    { label: "آخر الأخبار", prompt: "ما أهم الأخبار المؤثرة على السوق؟", icon: "news" },
    { label: "مراجعة صفقاتي", prompt: "راجع صفقاتي المفتوحة وأعطني توصية.", icon: "zap" },
  ];

  return (
    <div
      dir="rtl"
      className="rounded-2xl border border-border bg-card p-4 shadow-lg backdrop-blur-md"
    >
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Zap className="h-4 w-4" />
        </div>
        <p className="text-sm font-semibold text-foreground">إجراءات سريعة</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {list.map((a, idx) => {
          const Icon = (a.icon && ICONS[a.icon]) || Zap;
          return (
            <button
              key={idx}
              onClick={() => onAction?.("submit_prompt", { text: a.prompt })}
              className="flex items-center gap-2 rounded-xl border border-border bg-muted px-3 py-2.5 text-right text-sm font-medium text-foreground transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
            >
              <Icon className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate">{a.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Registry map
// ---------------------------------------------------------------------------
export const CONTROL_WIDGETS = {
  timeframe_picker: TimeframePicker,
  market_switch: MarketSwitch,
  mode_switch: ModeSwitch,
  strategy_picker: StrategyPicker,
  checklist: Checklist,
  step_progress: StepProgress,
  fear_greed: FearGreed,
  news_feed: NewsFeed,
  alert_banner: AlertBanner,
  confirm_dialog: ConfirmDialog,
  quick_actions: QuickActions,
};
