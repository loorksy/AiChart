"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { TradingSettings } from "@/lib/types";
import { PageLayout } from "@/components/ui/shell";

const EXPERT_STEPS = ["المستوى", "Binance", "الإعدادات", "تليجرام"] as const;
const BEGINNER_STEPS = [
  "المستوى",
  "أهدافك",
  "Binance",
  "الإعدادات",
  "تليجرام",
] as const;

export default function OnboardingClient({
  settings,
  hasBinance,
}: {
  settings: TradingSettings;
  hasBinance: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [experience, setExperience] = useState(settings.experience);
  const [mode, setMode] = useState(settings.mode);
  const [approval, setApproval] = useState(settings.approval);
  const [style, setStyle] = useState(settings.style);
  const [maxCapital, setMaxCapital] = useState(settings.max_capital || 100);
  const [perTrade, setPerTrade] = useState(settings.per_trade_pct || 10);
  const [dailyLoss, setDailyLoss] = useState(settings.daily_loss_limit_pct || 5);
  const [dailyProfit, setDailyProfit] = useState(
    settings.daily_profit_target_pct || 3,
  );
  const [tradingGoal, setTradingGoal] = useState("");
  const [suggestion, setSuggestion] = useState<{
    mode: "advisory" | "auto";
    style: "conservative" | "balanced" | "aggressive";
    per_trade_pct: number;
    max_open_trades: number;
    summary_ar: string;
  } | null>(null);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const isBeginner = experience === "beginner";
  const STEPS = isBeginner ? BEGINNER_STEPS : EXPERT_STEPS;
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: Record<string, unknown>, next?: number) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "فشل الحفظ.");
        return false;
      }
      if (next !== undefined) setStep(next);
      return true;
    } catch {
      setError("تعذّر الاتصال بالخادم.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function connectBinance() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/binance/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, apiSecret, env: "testnet" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "فشل الربط.");
        return;
      }
      setApiKey("");
      setApiSecret("");
      router.refresh();
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    const ok = await save({ finish: true });
    if (ok) {
      router.push("/dashboard");
      router.refresh();
    }
  }

  async function fetchSuggestion() {
    setSuggestBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxCapital,
          dailyProfit,
          dailyLoss,
          tradingGoal: tradingGoal || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "تعذّر الحصول على الاقتراح.");
        return;
      }
      setSuggestion(data.suggestion);
      setMode(data.suggestion.mode);
      setStyle(data.suggestion.style);
      setPerTrade(data.suggestion.per_trade_pct);
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setSuggestBusy(false);
    }
  }

  return (
    <PageLayout
      title="إعداد حسابك"
      subtitle="خطوات سريعة قبل البدء — يمكنك تعديل كل شيء لاحقاً من الإعدادات."
      maxWidth="2xl"
    >

      <div className="mb-8 flex gap-2">
        {STEPS.map((label, i) => (
          <div
            key={label}
            className={`flex-1 rounded-[var(--radius)] py-2 text-center text-xs font-medium ${
              i === step
                ? "bg-primary text-primary-foreground"
                : i < step
                  ? "bg-secondary text-foreground"
                  : "bg-card text-muted-foreground"
            }`}
          >
            {label}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-[var(--radius)] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="mb-4 rounded-[var(--radius)] border border-border bg-secondary/40 px-4 py-3 text-xs text-muted-foreground">
        تتداول على الكريبتو عبر Binance والفوركس عبر MetaTrader (EA). يمكنك ربط
        MetaTrader لاحقاً من{" "}
        <Link href="/settings?tab=integrations" className="text-link underline">
          الإعدادات ← الربط والتكامل
        </Link>
        .
      </div>

      {step === 0 && (
        <section className="card space-y-4 p-6">
          <h2 className="text-lg font-bold">ما مستوى خبرتك؟</h2>
          <label className="flex cursor-pointer items-center gap-3 rounded-[var(--radius)] border border-border p-4">
            <input
              type="radio"
              checked={experience === "beginner"}
              onChange={() => setExperience("beginner")}
            />
            <div>
              <div className="font-medium">مبتدئ</div>
              <div className="text-sm text-muted-foreground">
                الوكيل يقترح إعدادات آمنة ويشرح ببساطة.
              </div>
            </div>
          </label>
          <label className="flex cursor-pointer items-center gap-3 rounded-[var(--radius)] border border-border p-4">
            <input
              type="radio"
              checked={experience === "expert"}
              onChange={() => setExperience("expert")}
            />
            <div>
              <div className="font-medium">خبير</div>
              <div className="text-sm text-muted-foreground">
                أضبط كل الحدود بنفسي.
              </div>
            </div>
          </label>
          <button
            disabled={busy}
            onClick={() => {
              if (isBeginner) setStep(1);
              else void save({ experience }, 1);
            }}
            className="btn btn-primary w-full"
          >
            التالي
          </button>
        </section>
      )}

      {isBeginner && step === 1 && (
        <section className="card space-y-4 p-6">
          <h2 className="text-lg font-bold">حدّد أهدافك</h2>
          <p className="text-sm text-muted-foreground">
            أجب ببساطة — الوكيل يقترح إعدادات محافظة تناسب المبتدئين.
          </p>
          <label className="text-sm">كم رأس مال تخصّص للتداول؟ (USDT)</label>
          <input
            type="number"
            className="input w-full"
            min={10}
            value={maxCapital}
            onChange={(e) => setMaxCapital(Number(e.target.value))}
          />
          <label className="text-sm">هدف الربح اليومي (%)</label>
          <input
            type="number"
            className="input w-full"
            min={0.5}
            max={20}
            step={0.5}
            value={dailyProfit}
            onChange={(e) => setDailyProfit(Number(e.target.value))}
          />
          <label className="text-sm">أقصى خسارة يومية تتحمّلها (%)</label>
          <input
            type="number"
            className="input w-full"
            min={1}
            max={15}
            value={dailyLoss}
            onChange={(e) => setDailyLoss(Number(e.target.value))}
          />
          <label className="text-sm">هدفك من التداول (اختياري)</label>
          <textarea
            className="input min-h-20 w-full"
            placeholder="مثال: دخل إضافي شهري بحذر…"
            value={tradingGoal}
            onChange={(e) => setTradingGoal(e.target.value)}
          />
          <button
            type="button"
            disabled={suggestBusy || busy}
            onClick={() => void fetchSuggestion()}
            className="btn btn-secondary w-full"
          >
            {suggestBusy ? "جارٍ التحليل…" : "احصل على اقتراح الوكيل"}
          </button>

          {suggestion && (
            <div className="rounded-[var(--radius)] bg-secondary/60 px-4 py-3 text-sm">
              <p className="mb-2 font-medium">اقتراح الوكيل:</p>
              <p className="mb-2 text-muted-foreground">{suggestion.summary_ar}</p>
              <ul className="list-inside list-disc text-muted-foreground">
                <li>
                  {suggestion.mode === "auto" ? "تنفيذ تلقائي" : "توصيات + موافقة يدوية"}
                </li>
                <li>
                  أسلوب{" "}
                  {suggestion.style === "conservative"
                    ? "محافظ"
                    : suggestion.style === "balanced"
                      ? "متوازن"
                      : "نشِط"}{" "}
                  · {suggestion.per_trade_pct}% لكل صفقة · حدّ{" "}
                  {suggestion.max_open_trades} صفقات مفتوحة
                </li>
              </ul>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => setStep(0)} className="btn btn-secondary flex-1">
              رجوع
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void save(
                  {
                    experience: "beginner",
                    mode: suggestion?.mode ?? "advisory",
                    approval: "manual",
                    style: suggestion?.style ?? "conservative",
                    max_capital: maxCapital,
                    per_trade_pct: suggestion?.per_trade_pct ?? 5,
                    max_open_trades: suggestion?.max_open_trades ?? 2,
                    daily_profit_target_pct: dailyProfit,
                    daily_loss_limit_pct: dailyLoss,
                    monthly_loss_limit_pct: Math.min(dailyLoss * 4, 20),
                  },
                  2,
                )
              }
              className="btn btn-primary flex-1"
            >
              حفظ والمتابعة
            </button>
          </div>
        </section>
      )}

      {step === (isBeginner ? 2 : 1) && (
        <section className="card space-y-4 p-6">
          <h2 className="text-lg font-bold">ربط Binance (Testnet)</h2>
          <p className="text-sm text-muted-foreground">
            فعّل <b>التداول</b> فقط وعطّل <b>السحب</b>. ابدأ دائماً ببيئة تجريبية.
          </p>
          {hasBinance ? (
            <div className="rounded-[var(--radius)] bg-secondary px-4 py-3 text-sm text-primary">
              ● تم ربط الحساب بنجاح
            </div>
          ) : (
            <>
              <input
                className="input w-full"
                placeholder="API Key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                dir="ltr"
              />
              <input
                className="input w-full"
                type="password"
                placeholder="API Secret"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                dir="ltr"
              />
              <button
                disabled={busy || !apiKey || !apiSecret}
                onClick={connectBinance}
                className="btn btn-secondary w-full"
              >
                ربط والتحقق
              </button>
            </>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => setStep(isBeginner ? 1 : 0)}
              className="btn btn-secondary flex-1"
            >
              رجوع
            </button>
            <button
              disabled={busy}
              onClick={() => setStep(isBeginner ? 3 : 2)}
              className="btn btn-primary flex-1"
            >
              {hasBinance ? "التالي" : "تخطّي مؤقتاً"}
            </button>
          </div>
        </section>
      )}

      {step === (isBeginner ? 3 : 2) && (
        <section className="card space-y-4 p-6">
          <h2 className="text-lg font-bold">أسلوب التداول</h2>
          <select
            className="input w-full"
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="advisory">توصيات فقط</option>
            <option value="auto">تنفيذ تلقائي (يتطلب موافقة الأدمن)</option>
          </select>
          <select
            className="input w-full"
            value={approval}
            onChange={(e) => setApproval(e.target.value as typeof approval)}
          >
            <option value="manual">تأكيد يدوي لكل صفقة</option>
            <option value="delegate">تفويض تلقائي ضمن الحدود</option>
          </select>
          <select
            className="input w-full"
            value={style}
            onChange={(e) => setStyle(e.target.value as typeof style)}
          >
            <option value="conservative">محافظ</option>
            <option value="balanced">متوازن</option>
            <option value="aggressive">نشِط</option>
          </select>
          {experience === "beginner" && (
            <>
              <label className="text-sm">المبلغ المسموح (USDT)</label>
              <input
                type="number"
                className="input w-full"
                value={maxCapital}
                onChange={(e) => setMaxCapital(Number(e.target.value))}
              />
              <label className="text-sm">حجم الصفقة (%)</label>
              <input
                type="number"
                className="input w-full"
                value={perTrade}
                onChange={(e) => setPerTrade(Number(e.target.value))}
              />
              <label className="text-sm">حد الخسارة اليومي (%)</label>
              <input
                type="number"
                className="input w-full"
                value={dailyLoss}
                onChange={(e) => setDailyLoss(Number(e.target.value))}
              />
            </>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => setStep(isBeginner ? 2 : 1)}
              className="btn btn-secondary flex-1"
            >
              رجوع
            </button>
            <button
              disabled={busy}
              onClick={() =>
                save(
                  {
                    mode,
                    approval,
                    style,
                    max_capital: maxCapital,
                    per_trade_pct: perTrade,
                    daily_loss_limit_pct: dailyLoss,
                    daily_profit_target_pct: dailyProfit,
                  },
                  isBeginner ? 4 : 3,
                )
              }
              className="btn btn-primary flex-1"
            >
              التالي
            </button>
          </div>
        </section>
      )}

      {step === (isBeginner ? 4 : 3) && (
        <section className="card space-y-4 p-6">
          <h2 className="text-lg font-bold">ربط تليجرام (اختياري)</h2>
          <p className="text-sm text-muted-foreground">
            لاستلام إشعارات الصفقات والملخّص اليومي. يمكنك الربط لاحقاً من
            الإعدادات.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setStep(isBeginner ? 3 : 2)}
              className="btn btn-secondary flex-1"
            >
              رجوع
            </button>
            <button disabled={busy} onClick={finish} className="btn btn-primary flex-1">
              إنهاء والبدء
            </button>
          </div>
        </section>
      )}
    </PageLayout>
  );
}
