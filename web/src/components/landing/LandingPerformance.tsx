"use client";

import { Activity, CheckCircle2, Scale, ShieldCheck } from "lucide-react";
import { useLocale } from "@/components/LocaleProvider";

export function LandingPerformance() {
  const { locale } = useLocale();
  const isRtl = locale === "ar";

  const checks = isRtl
    ? [
        "موافقة صريحة من المستخدم",
        "اتصال حساب MetaTrader",
        "سعر حديث صالح للتنفيذ",
        "منع تكرار طلب التنفيذ",
      ]
    : [
        "Explicit user approval",
        "Connected MetaTrader account",
        "Fresh executable price",
        "Duplicate-execution protection",
      ];

  const trace = isRtl
    ? [
        { label: "سياق التحليل", value: "EURUSD · 15m · بيانات حديثة" },
        { label: "القرار المرجعي", value: "WAIT — لا توجد صفقة قابلة للتنفيذ" },
        { label: "حجم المخاطرة", value: "لا يُحسب إلا عند وجود صفقة مؤكدة" },
        { label: "التنفيذ", value: "متوقف — لا يمكن للحماية تحويل WAIT إلى صفقة" },
      ]
    : [
        { label: "Analysis context", value: "EURUSD · 15m · fresh data" },
        { label: "Canonical decision", value: "WAIT — no executable setup" },
        { label: "Risk sizing", value: "Calculated only for a confirmed trade" },
        { label: "Execution", value: "Stopped — safety cannot turn WAIT into a trade" },
      ];

  return (
    <section className="relative mx-auto max-w-6xl overflow-hidden px-4 py-16 sm:px-6">
      <div className="absolute left-1/2 top-1/2 -z-10 h-[300px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/8 blur-[80px]" />

      <div className="grid items-center gap-8 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-2">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary">
              <Activity className="h-3.5 w-3.5" />
              <span>{isRtl ? "مسار قرار قابل للمراجعة" : "Reviewable Decision Flow"}</span>
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {isRtl ? "من التحليل إلى التنفيذ بدون ادعاءات أداء" : "From Analysis to Execution, Without Performance Claims"}
            </h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {isRtl
                ? "يعرض AiChart القرار وأسبابه وحالة فحوص التنفيذ. الإحصاءات داخل حسابك مبنية على نتائجك المسجلة، وليست أرقاماً تسويقية مصطنعة."
                : "AiChart shows the decision, its reasons, and execution-check status. Account statistics come from your recorded outcomes, not invented marketing numbers."}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="glass-card p-4">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="font-mono text-[10px] uppercase tracking-wider">
                  {isRtl ? "سلطة القرار" : "Decision authority"}
                </span>
                <ShieldCheck className="h-4 w-4 text-primary" />
              </div>
              <p className="mt-2 text-lg font-bold text-foreground">BUY · SELL · WAIT</p>
            </div>

            <div className="glass-card p-4">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="font-mono text-[10px] uppercase tracking-wider">
                  {isRtl ? "إعداد المخاطرة" : "Risk setting"}
                </span>
                <Scale className="h-4 w-4 text-primary" />
              </div>
              <p className="mt-2 text-lg font-bold text-primary">Risk per Trade</p>
            </div>
          </div>

          <div className="glass-card p-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {isRtl ? "فحوص التنفيذ" : "Execution checks"}
            </p>
            <ul className="mt-3 grid gap-2 text-xs text-foreground/80">
              {checks.map((check) => (
                <li key={check} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>{check}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="glass-card border-primary/25 p-5 lg:col-span-3">
          <div className="mb-4 flex items-center justify-between border-b border-border pb-3.5">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-primary" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-foreground/80">
                {isRtl ? "مثال توضيحي لمسار القرار" : "Illustrative decision trace"}
              </span>
            </div>
            <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
              {isRtl ? "ليس أداءً مباشراً" : "Not live performance"}
            </span>
          </div>

          <div className="space-y-2.5">
            {trace.map((row, index) => (
              <div
                key={row.label}
                className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/20 p-3"
              >
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 font-mono text-[10px] font-bold text-primary">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{row.label}</p>
                  <p className="mt-1 text-xs font-medium leading-relaxed text-foreground/85">{row.value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
