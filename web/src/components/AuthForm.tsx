"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, Sparkles } from "lucide-react";
import PriceChart from "@/components/PriceChart";
import { TelegramLoginButton } from "@/components/TelegramLoginButton";

export default function AuthForm({
  mode,
  redirectTo,
  botUsername,
  telegramConfigured,
}: {
  mode: "login" | "register";
  redirectTo?: string;
  botUsername?: string | null;
  telegramConfigured?: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const isLogin = mode === "login";
  const canUseTelegram = telegramConfigured && Boolean(botUsername);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/auth/${isLogin ? "login" : "register"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "حدث خطأ.");
        return;
      }
      router.push(isLogin ? (redirectTo ?? "/chat") : "/onboarding");
      router.refresh();
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh">
      <div className="flex w-full flex-col justify-center bg-background px-6 py-10 sm:px-10 lg:w-[42%] lg:max-w-lg lg:px-14">
        <Link href="/" className="mb-10 flex items-center gap-2 text-lg font-semibold">
          <Sparkles className="h-5 w-5" />
          AiChart
        </Link>

        <h1 className="text-2xl font-semibold leading-tight text-foreground sm:text-3xl">
          {isLogin ? "مرحباً بعودتك" : "إنشاء حساب جديد"}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {canUseTelegram
            ? "سجّل أو ادخل عبر تليجرام — يُربط البوت تلقائياً بحسابك."
            : "سجّل الدخول للوصول إلى وكيل التداول"}
        </p>

        {canUseTelegram && (
          <div className="mt-8 space-y-4">
            <TelegramLoginButton
              botUsername={botUsername!}
              redirectTo={redirectTo}
              onError={setError}
            />
            <p className="text-center text-xs text-muted-foreground">
              بعد الدخول ستصلك إشعارات الصفقات على نفس حساب تليجرام — بدون رمز
              يدوي.
            </p>
            <div className="relative py-2">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <p className="relative mx-auto w-fit bg-background px-3 text-xs text-muted-foreground">
                أو
              </p>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {canUseTelegram ? (
          <button
            type="button"
            onClick={() => setShowEmail((v) => !v)}
            className="mt-2 flex w-full items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            الدخول بالبريد (للمشرفين)
            <ChevronDown
              className={`h-4 w-4 transition ${showEmail ? "rotate-180" : ""}`}
            />
          </button>
        ) : null}

        {(showEmail || !canUseTelegram) && (
          <form onSubmit={submit} className="mt-4 space-y-4">
            <div>
              <label htmlFor="email">البريد الإلكتروني</label>
              <input
                id="email"
                type="email"
                required
                className="input mt-1.5"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                dir="ltr"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label htmlFor="password">كلمة المرور</label>
              <input
                id="password"
                type="password"
                required
                minLength={isLogin ? 1 : 8}
                className="input mt-1.5"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                dir="ltr"
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary w-full py-3"
              disabled={loading}
            >
              {loading ? "جارٍ المعالجة…" : isLogin ? "متابعة بالبريد" : "إنشاء حساب"}
              {!loading && <ArrowUpRight className="h-4 w-4" />}
            </button>
          </form>
        )}

        {!isLogin && canUseTelegram && (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            لديك حساب؟{" "}
            <Link href="/login" className="text-link font-medium">
              دخول
            </Link>
          </p>
        )}
        {isLogin && (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            {!canUseTelegram && "ليس لديك حساب؟ "}
            <Link
              href="/register"
              className="text-link font-medium"
            >
              {canUseTelegram ? "تسجيل جديد عبر تليجرام" : "سجّل الآن"}
            </Link>
          </p>
        )}
      </div>

      <div className="relative hidden flex-1 lg:block">
        <div className="absolute inset-0 overflow-hidden">
          <div className="chart-bg-canvas absolute -inset-[15%]">
            <PriceChart
              symbol="BTCUSDT"
              interval="1h"
              recommendations={[]}
              ambient
              fill
              className="h-full"
            />
          </div>
          <div className="absolute inset-0 bg-background/92" />
        </div>
        <div className="relative flex h-full items-center justify-center p-8">
          <div className="surface-card w-full max-w-2xl overflow-hidden">
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-semibold text-foreground">معاينة السوق الحي</p>
              <p className="text-xs text-muted-foreground">BTCUSDT · بيانات Binance</p>
            </div>
            <PriceChart symbol="BTCUSDT" interval="1h" recommendations={[]} className="h-[360px]" />
          </div>
        </div>
      </div>
    </div>
  );
}
