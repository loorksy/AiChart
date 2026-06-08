"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import {
  StepIndicator,
  SurfaceCard,
  PillButton,
} from "@/components/ui/shell";
import { cn } from "@/lib/utils";
import { useMe } from "@/hooks/useMe";

interface Instrument {
  symbol: string;
  base: string;
  quote: string;
}

const STEP_LABELS = ["الأداة", "الأسلوب", "المخاطر", "التأكيد"];

const CAPITAL_OPTIONS = [500, 1000, 2500, 5000, 10000];

export default function SignalsWizardClient() {
  const router = useRouter();
  const { data: me, refresh: refreshMe } = useMe();
  const [step, setStep] = useState(1);
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [style, setStyle] = useState<"scalp" | "swing">("swing");
  const [riskPct, setRiskPct] = useState(2);
  const [capital, setCapital] = useState(1000);
  const [stopLossStyle, setStopLossStyle] = useState<
    "tight" | "balanced" | "wide"
  >("balanced");
  const [notes, setNotes] = useState("");

  const [search, setSearch] = useState("");
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [loadingInstruments, setLoadingInstruments] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = me?.quota.remaining ?? 0;

  const fetchInstruments = useCallback(async (q: string) => {
    setLoadingInstruments(true);
    try {
      const params = q ? `?q=${encodeURIComponent(q)}&wrapped=1` : "?wrapped=1";
      const res = await fetch(`/api/instruments${params}`);
      const data = await res.json();
      if (res.ok) {
        setInstruments(
          Array.isArray(data) ? data : (data.instruments ?? []),
        );
      }
    } catch {
      setInstruments([]);
    } finally {
      setLoadingInstruments(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void fetchInstruments(search), 300);
    return () => clearTimeout(t);
  }, [search, fetchInstruments]);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/signals/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          style,
          riskPct,
          capital,
          stopLossStyle,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "فشل توليد الخطة.");
        return;
      }
      void refreshMe();
      sessionStorage.setItem(
        "aichart_pending_prompt",
        `اعرض خطة الإشارة التي أنشأتها لـ ${symbol}`,
      );
      router.push("/chat");
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setGenerating(false);
    }
  }

  function next() {
    if (step < 4) setStep(step + 1);
    else void generate();
  }

  function back() {
    if (step > 1) setStep(step - 1);
  }

  const canNext =
    step === 1
      ? Boolean(symbol)
      : step === 2
        ? Boolean(style)
        : step === 3
          ? riskPct > 0 && capital > 0
          : remaining >= 5;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-lg space-y-6">
          <div>
            <h1 className="page-title">إشارة جديدة</h1>
            <p className="page-subtitle">معالج 4 خطوات — Binance فقط</p>
          </div>

          <StepIndicator current={step} labels={STEP_LABELS} />

          {error && (
            <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  className="input ps-10"
                  placeholder="ابحث عن زوج USDT…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  dir="ltr"
                />
              </div>
              {loadingInstruments && (
                <p className="text-center text-sm text-muted-foreground">
                  جارٍ التحميل…
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                {instruments.map((inst) => (
                  <button
                    key={inst.symbol}
                    type="button"
                    onClick={() => setSymbol(inst.symbol)}
                    className={cn(
                      "rounded-xl border px-3 py-3 text-start transition",
                      symbol === inst.symbol
                        ? "border-primary bg-secondary"
                        : "border-border bg-card hover:bg-secondary/50",
                    )}
                  >
                    <p className="font-semibold" dir="ltr">
                      {inst.base}
                    </p>
                    <p className="text-[10px] text-muted-foreground" dir="ltr">
                      {inst.symbol}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  {
                    id: "scalp" as const,
                    label: "سكالب",
                    desc: "15 دقيقة — صفقات سريعة",
                  },
                  {
                    id: "swing" as const,
                    label: "سوينغ",
                    desc: "4 ساعات — صفقات متوسطة",
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setStyle(opt.id)}
                  className={cn(
                    "rounded-[var(--radius)] border p-4 text-start transition",
                    style === opt.id
                      ? "border-primary bg-secondary"
                      : "border-border bg-card hover:bg-secondary/50",
                  )}
                >
                  <p className="font-serif text-lg font-bold">{opt.label}</p>
                  <p className="text-sm text-muted-foreground">{opt.desc}</p>
                </button>
              ))}
            </div>
          )}

          {step === 3 && (
            <SurfaceCard className="space-y-5">
              <div>
                <label className="mb-2 block">
                  نسبة المخاطرة: {riskPct}%
                </label>
                <input
                  type="range"
                  min={0.5}
                  max={5}
                  step={0.5}
                  value={riskPct}
                  onChange={(e) => setRiskPct(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>

              <div>
                <label className="mb-2 block">رأس المال</label>
                <div className="flex flex-wrap gap-2">
                  {CAPITAL_OPTIONS.map((c) => (
                    <PillButton
                      key={c}
                      variant={capital === c ? "primary" : "outline"}
                      onClick={() => setCapital(c)}
                      className="text-xs"
                    >
                      ${c.toLocaleString()}
                    </PillButton>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-2 block">أسلوب وقف الخسارة</label>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { id: "tight" as const, label: "ضيّق" },
                      { id: "balanced" as const, label: "متوازن" },
                      { id: "wide" as const, label: "واسع" },
                    ] as const
                  ).map((opt) => (
                    <PillButton
                      key={opt.id}
                      variant={stopLossStyle === opt.id ? "primary" : "outline"}
                      onClick={() => setStopLossStyle(opt.id)}
                    >
                      {opt.label}
                    </PillButton>
                  ))}
                </div>
              </div>
            </SurfaceCard>
          )}

          {step === 4 && (
            <SurfaceCard className="space-y-4">
              <h2 className="font-serif text-xl font-bold">ملخص الخطة</h2>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">الأداة</dt>
                  <dd className="font-medium" dir="ltr">
                    {symbol}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">الأسلوب</dt>
                  <dd className="font-medium">
                    {style === "scalp" ? "سكالب (15m)" : "سوينغ (4h)"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">المخاطرة</dt>
                  <dd className="font-medium">{riskPct}%</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">رأس المال</dt>
                  <dd className="font-medium">${capital.toLocaleString()}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">وقف الخسارة</dt>
                  <dd className="font-medium">
                    {stopLossStyle === "tight"
                      ? "ضيّق"
                      : stopLossStyle === "balanced"
                        ? "متوازن"
                        : "واسع"}
                  </dd>
                </div>
              </dl>

              <div>
                <label className="mb-1 block text-sm">ملاحظات (اختياري)</label>
                <textarea
                  className="input min-h-[80px] resize-none"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="أي تفضيلات إضافية…"
                />
              </div>

              <p className="text-xs text-muted-foreground">
                توليد الخطة يخصم 5 رصيد • متبقّي: {remaining}
              </p>
            </SurfaceCard>
          )}
        </div>
      </div>

      <footer className="shrink-0 border-t border-border bg-background/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md">
        <div className="mx-auto flex max-w-lg gap-3">
          {step > 1 && (
            <button
              type="button"
              onClick={back}
              className="btn btn-secondary flex-1"
              disabled={generating}
            >
              رجوع
            </button>
          )}
          <button
            type="button"
            onClick={() => void next()}
            disabled={!canNext || generating}
            className="btn btn-primary flex-1"
          >
            {generating
              ? "جارٍ التوليد…"
              : step === 4
                ? "توليد الخطة (5 رصيد)"
                : "التالي"}
          </button>
        </div>
      </footer>
    </div>
  );
}
