"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, Sparkles } from "lucide-react";
import PriceChart from "@/components/PriceChart";
import { TelegramLoginButton } from "@/components/TelegramLoginButton";
import type { CountryCode } from "libphonenumber-js";
import { PhoneInput } from "@/components/PhoneInput";

export default function AuthForm({
  mode,
  redirectTo,
  botUsername,
  telegramConfigured,
  allowRegister = true,
  gateMode = false,
  defaultCountry,
}: {
  mode: "login" | "register";
  redirectTo?: string;
  botUsername?: string | null;
  telegramConfigured?: boolean;
  allowRegister?: boolean;
  gateMode?: boolean;
  defaultCountry?: CountryCode;
}) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isLogin = mode === "login";
  const canUseTelegram = !gateMode && telegramConfigured && Boolean(botUsername);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body = gateMode
        ? { password }
        : isLogin
          ? { email, password }
          : { username, whatsapp, email, password };

      const res = await fetch(`/api/auth/${isLogin ? "login" : "register"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "حدث خطأ.");
        return;
      }
      const dest =
        data.platform_access === true
          ? isLogin
            ? (redirectTo ?? "/console")
            : "/awaiting-approval"
          : "/awaiting-approval";
      router.push(dest);
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
          {gateMode
            ? "دخول المشغّل"
            : isLogin
              ? "تسجيل الدخول"
              : "إنشاء حساب"}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {gateMode
            ? "أدخل كلمة المرور للوصول إلى منصتك"
            : isLogin
              ? "أدخل بريدك وكلمة المرور"
              : "سجّل بياناتك — التفعيل بعد موافقة الإدارة"}
        </p>

        {canUseTelegram && (
          <div className="mt-8 space-y-4">
            <TelegramLoginButton
              botUsername={botUsername!}
              redirectTo={redirectTo}
              onError={setError}
            />
            <div className="relative py-2">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <p className="relative mx-auto w-fit bg-background px-3 text-xs text-muted-foreground">
                {isLogin ? "أو الدخول بالبريد" : "أو التسجيل بالبريد"}
              </p>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <form onSubmit={submit} className="mt-4 space-y-4">
          {!gateMode && !isLogin && (
            <>
              <div>
                <label htmlFor="username">اسم المستخدم</label>
                <input
                  id="username"
                  required
                  minLength={3}
                  maxLength={32}
                  pattern="[a-zA-Z0-9_.]+"
                  className="input mt-1.5"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  dir="ltr"
                  placeholder="ahmed_trader"
                />
              </div>
              <div>
                <label>رقم واتساب</label>
                <div className="mt-1.5">
                  <PhoneInput
                    value={whatsapp}
                    onChange={setWhatsapp}
                    disabled={loading}
                    defaultCountry={defaultCountry}
                  />
                </div>
              </div>
            </>
          )}
          {!gateMode && (
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
          )}
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
              autoFocus={gateMode}
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary w-full py-3"
            disabled={loading}
          >
            {loading
              ? "جارٍ المعالجة…"
              : gateMode
                ? "دخول"
                : isLogin
                  ? "تسجيل الدخول"
                  : "إنشاء حساب"}
            {!loading && <ArrowUpRight className="h-4 w-4" />}
          </button>
        </form>

        {isLogin && allowRegister && (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            ليس لديك حساب؟{" "}
            <Link href="/signup" className="text-link font-medium">
              سجّل الآن
            </Link>
          </p>
        )}
        {!isLogin && (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            لديك حساب؟{" "}
            <Link href="/login" className="text-link font-medium">
              دخول
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
              <p className="text-sm font-semibold text-foreground">AiChart</p>
              <p className="text-xs text-muted-foreground">Claude MCP · Binance · MT5</p>
            </div>
            <PriceChart symbol="BTCUSDT" interval="1h" recommendations={[]} className="h-[360px]" />
          </div>
        </div>
      </div>
    </div>
  );
}
