"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ChartBackdrop } from "@/components/chart/ChartBackdrop";
import { TelegramLoginButton } from "@/components/TelegramLoginButton";
import type { CountryCode } from "libphonenumber-js";
import { PhoneInput } from "@/components/PhoneInput";
import { AiChartLogo } from "@/components/AiChartLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useLocale } from "@/hooks/useLocale";
import { BRAND_NAME } from "@/lib/brand";

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
  const { t, dir } = useLocale();
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
        setError(data.error ?? t("auth.generic_error"));
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
      setError(t("auth.network_error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="relative flex min-h-dvh w-full max-w-[100vw] overflow-x-hidden"
      dir={dir}
    >
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-background">
        <div className="absolute left-1/2 top-0 h-[280px] w-[480px] max-w-full -translate-x-1/2 rounded-full bg-muted/40 blur-[80px]" />
      </div>

      <main className="mx-auto flex w-full min-w-0 max-w-lg flex-col justify-center px-4 py-8 outline-none sm:px-8 sm:py-10 lg:mx-0 lg:w-[42%] lg:max-w-lg lg:px-14">
        <div className="glass-card min-w-0 max-w-full overflow-hidden p-5 sm:p-8">
          <div className="mb-8 flex min-w-0 items-center justify-between gap-3">
            <Link
              href="/"
              className="flex min-w-0 items-center gap-2 text-lg font-semibold"
            >
              <AiChartLogo size={20} showName nameClassName="truncate text-lg" />
            </Link>
            <div className="shrink-0" aria-label={t("auth.switch_language")}>
              <LanguageSwitcher />
            </div>
          </div>

          <h1 className="text-2xl font-semibold leading-tight text-foreground sm:text-3xl">
            {gateMode
              ? t("auth.operator_title")
              : isLogin
                ? t("auth.login_title")
                : t("auth.register_title")}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {gateMode
              ? t("auth.operator_subtitle")
              : isLogin
                ? t("auth.login_subtitle")
                : t("auth.register_subtitle")}
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
                <p className="relative mx-auto w-fit bg-card/80 px-3 text-xs text-muted-foreground backdrop-blur-sm">
                  {isLogin ? t("auth.telegram_or_login") : t("auth.telegram_or_register")}
                </p>
              </div>
            </div>
          )}

          {error && (
            <p
              role="alert"
              aria-live="assertive"
              className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          <form onSubmit={submit} className="mt-4 space-y-4">
            {!gateMode && !isLogin && (
              <>
                <div>
                  <label htmlFor="username">{t("auth.username")}</label>
                  <input
                    id="username"
                    name="username"
                    required
                    minLength={3}
                    maxLength={32}
                    pattern="[a-zA-Z0-9_.]+"
                    autoComplete="username"
                    className="input mt-1.5 focus:border-primary focus:ring-2 focus:ring-primary/25"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    dir="ltr"
                    placeholder="ahmed_trader"
                  />
                </div>
                <div>
                  <label>{t("auth.whatsapp")}</label>
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
                <label htmlFor="email">{t("auth.email")}</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  className="input mt-1.5 focus:border-primary focus:ring-2 focus:ring-primary/25"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  dir="ltr"
                  placeholder="you@example.com"
                />
              </div>
            )}
            <div>
              <label htmlFor="password">{t("auth.password")}</label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={isLogin ? 1 : 8}
                autoComplete={isLogin || gateMode ? "current-password" : "new-password"}
                className="input mt-1.5 focus:border-primary focus:ring-2 focus:ring-primary/25"
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
                ? t("auth.processing")
                : gateMode
                  ? t("auth.operator_action")
                  : isLogin
                    ? t("auth.login_action")
                    : t("auth.register_action")}
              {!loading && <ArrowUpRight className="h-4 w-4 rtl:-rotate-90" />}
            </button>
          </form>

          {isLogin && allowRegister && (
            <p className="mt-6 text-center text-sm text-muted-foreground">
              {t("auth.no_account")}{" "}
              <Link href="/signup" className="text-link font-medium">
                {t("auth.register_now")}
              </Link>
            </p>
          )}
          {!isLogin && (
            <p className="mt-6 text-center text-sm text-muted-foreground">
              {t("auth.have_account")}{" "}
              <Link href="/login" className="text-link font-medium">
                {t("auth.sign_in")}
              </Link>
            </p>
          )}
        </div>
      </main>

      <div className="relative hidden flex-1 lg:block">
        <div className="absolute inset-0 overflow-hidden">
          <div className="chart-bg-canvas absolute -inset-[15%]">
            <ChartBackdrop className="h-full" />
          </div>
          <div className="absolute inset-0 bg-background/80" />
        </div>
        <div className="relative flex h-full items-center justify-center p-8">
          <div className="glass-card w-full max-w-2xl overflow-hidden">
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-semibold text-foreground">{BRAND_NAME}</p>
              <p className="text-xs text-muted-foreground">{t("auth.preview_subtitle")}</p>
            </div>
            <ChartBackdrop className="h-[360px]" />
          </div>
        </div>
      </div>
    </div>
  );
}
