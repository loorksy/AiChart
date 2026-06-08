"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TradingSettings } from "@/lib/types";

const STEPS = ["المستوى", "Binance", "الإعدادات", "تليجرام"] as const;

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

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <h1 className="mb-2 text-3xl font-bold">إعداد حسابك</h1>
      <p className="mb-8 text-[var(--muted)]">
        خطوات سريعة قبل البدء — يمكنك تعديل كل شيء لاحقاً من الإعدادات.
      </p>

      <div className="mb-8 flex gap-2">
        {STEPS.map((label, i) => (
          <div
            key={label}
            className={`flex-1 rounded-lg py-2 text-center text-xs font-medium ${
              i === step
                ? "bg-[var(--accent)] text-white"
                : i < step
                  ? "bg-[var(--surface-2)] text-[var(--foreground)]"
                  : "bg-[var(--surface)] text-[var(--muted)]"
            }`}
          >
            {label}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-[var(--danger)] bg-[var(--danger)]/10 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {step === 0 && (
        <section className="card space-y-4 p-6">
          <h2 className="text-lg font-bold">ما مستوى خبرتك؟</h2>
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--border)] p-4">
            <input
              type="radio"
              checked={experience === "beginner"}
              onChange={() => setExperience("beginner")}
            />
            <div>
              <div className="font-medium">مبتدئ</div>
              <div className="text-sm text-[var(--muted)]">
                الوكيل يقترح إعدادات آمنة ويشرح ببساطة.
              </div>
            </div>
          </label>
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--border)] p-4">
            <input
              type="radio"
              checked={experience === "expert"}
              onChange={() => setExperience("expert")}
            />
            <div>
              <div className="font-medium">خبير</div>
              <div className="text-sm text-[var(--muted)]">
                أضبط كل الحدود بنفسي.
              </div>
            </div>
          </label>
          <button
            disabled={busy}
            onClick={() => save({ experience }, 1)}
            className="btn btn-primary w-full"
          >
            التالي
          </button>
        </section>
      )}

      {step === 1 && (
        <section className="card space-y-4 p-6">
          <h2 className="text-lg font-bold">ربط Binance (Testnet)</h2>
          <p className="text-sm text-[var(--muted)]">
            فعّل <b>التداول</b> فقط وعطّل <b>السحب</b>. ابدأ دائماً ببيئة تجريبية.
          </p>
          {hasBinance ? (
            <div className="rounded-lg bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--accent)]">
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
            <button onClick={() => setStep(0)} className="btn btn-secondary flex-1">
              رجوع
            </button>
            <button
              disabled={busy}
              onClick={() => setStep(2)}
              className="btn btn-primary flex-1"
            >
              {hasBinance ? "التالي" : "تخطّي مؤقتاً"}
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
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
            <button onClick={() => setStep(1)} className="btn btn-secondary flex-1">
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
                  },
                  3,
                )
              }
              className="btn btn-primary flex-1"
            >
              التالي
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="card space-y-4 p-6">
          <h2 className="text-lg font-bold">ربط تليجرام (اختياري)</h2>
          <p className="text-sm text-[var(--muted)]">
            لاستلام إشعارات الصفقات والملخّص اليومي. يمكنك الربط لاحقاً من
            الإعدادات.
          </p>
          <div className="flex gap-3">
            <button onClick={() => setStep(2)} className="btn btn-secondary flex-1">
              رجوع
            </button>
            <button disabled={busy} onClick={finish} className="btn btn-primary flex-1">
              إنهاء والبدء
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
