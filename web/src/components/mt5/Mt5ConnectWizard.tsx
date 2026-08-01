"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Link2, Loader2, ShieldCheck } from "lucide-react";

import { PageHeader, Surface } from "@/components/foundation";
import { Button, buttonVariants } from "@/components/squareui/button";
import { cn } from "@/lib/utils";

interface ExistingAccount {
  platform: string;
  server: string;
  login: string;
  state: string | null;
}

type Step = "server" | "credentials" | "progress" | "done";

const STEPS: { key: Step; label: string }[] = [
  { key: "server", label: "الخادم" },
  { key: "credentials", label: "تسجيل الدخول" },
  { key: "progress", label: "الربط" },
];

const FIELD =
  "min-h-11 w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm";

/**
 * V2-B (#96): the transparent linking wizard.
 *
 * Transparency is a requirement, not a style choice: the user is told in
 * plain words that they are signing in to their REAL MetaTrader account
 * through the MetaApi cloud, what is stored (encrypted) and what happens
 * next. Broker search is live when configured; manual server entry always
 * works as the fallback.
 */
export function Mt5ConnectWizard({
  enabled,
  existing,
}: {
  enabled: boolean;
  existing: ExistingAccount | null;
}) {
  const [step, setStep] = useState<Step>("server");
  const [server, setServer] = useState(existing?.server ?? "");
  const [query, setQuery] = useState("");
  const [servers, setServers] = useState<string[]>([]);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "unavailable">("idle");
  const [platform, setPlatform] = useState<"mt5" | "mt4">("mt5");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("جارٍ تجهيز الحساب السحابي…");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setServers([]);
      return;
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearchState("loading");
      fetch(`/api/mt5/brokers?q=${encodeURIComponent(query.trim())}`)
        .then(async (res) => {
          const data = (await res.json()) as { ok: boolean; servers: string[] };
          setServers(data.servers ?? []);
          setSearchState(data.ok ? "idle" : "unavailable");
        })
        .catch(() => setSearchState("unavailable"));
    }, 350);
  }, [query]);

  async function connect() {
    setStep("progress");
    setError(null);
    setStatus("جارٍ إنشاء الحساب السحابي والاتصال بوسيطك…");
    try {
      const res = await fetch("/api/agent/mt/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, server: server.trim(), login, password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        state?: string;
      };
      if (!res.ok || data.ok === false) {
        setError(data.error ?? "تعذّر الربط — تحقق من البيانات وحاول مجدداً.");
        setStep("credentials");
        return;
      }
      setStatus("تم الربط! جارٍ سحب سنة كاملة من البيانات التاريخية في الخلفية…");
      setStep("done");
    } catch {
      setError("تعذّر الاتصال بالخادم.");
      setStep("credentials");
    }
  }

  if (!enabled) {
    return (
      <div dir="rtl" className="space-y-6">
        <PageHeader
          title="ربط حساب MetaTrader 5"
          icon={<Link2 aria-hidden="true" />}
        />
        <Surface padding="lg">
          <p className="text-sm leading-relaxed text-muted-foreground">
            الربط السحابي غير مفعَّل بعد على هذه المنصة. سيتاح فور اكتمال إعداده —
            وحتى ذلك الحين يمكن استخدام جسر الـ EA كما هو.
          </p>
        </Surface>
      </div>
    );
  }

  const activeIndex = step === "done" ? STEPS.length - 1 : STEPS.findIndex((s) => s.key === step);

  return (
    <div dir="rtl" className="space-y-6">
      <PageHeader
        title="ربط حساب MetaTrader 5"
        description="ربط شفاف عبر سحابة MetaApi — أنت تسجّل الدخول إلى حسابك الحقيقي لدى وسيطك."
        icon={<Link2 aria-hidden="true" />}
      />

      {/* An ordered list so the wizard's shape is available to a screen reader,
          not just implied by the colour of three bars. */}
      <ol className="flex items-center gap-2" aria-label="خطوات الربط">
        {STEPS.map((s, i) => {
          const state = i < activeIndex ? "done" : i === activeIndex ? "current" : "todo";
          return (
            <li key={s.key} className="flex flex-1 flex-col gap-1.5">
              <span
                aria-hidden="true"
                className={cn(
                  "h-1 rounded-full transition-colors duration-200",
                  state === "todo" ? "bg-border" : "bg-primary",
                )}
              />
              <span
                className={cn(
                  "type-caption",
                  state === "current" && "font-semibold text-foreground",
                )}
                aria-current={state === "current" ? "step" : undefined}
              >
                {i + 1} · {s.label}
              </span>
            </li>
          );
        })}
      </ol>

      {existing && step === "server" && (
        <Surface padding="sm" className="bg-muted/30">
          <p className="type-caption">
            حساب مرتبط حالياً: {existing.platform.toUpperCase()} · {existing.login} @{" "}
            {existing.server} — إكمال المعالج يستبدله.
          </p>
        </Surface>
      )}

      <Surface padding="lg">
        {step === "server" && (
          <div className="space-y-4">
            <h2 className="type-heading">1 · اختر خادم وسيطك</h2>

            <div className="space-y-1.5">
              <label htmlFor="mt5-broker-search" className="type-caption block font-medium">
                ابحث عن وسيطك
              </label>
              <input
                id="mt5-broker-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="مثال: Exness, IC Markets…"
                className={FIELD}
              />
            </div>

            <div aria-live="polite">
              {searchState === "loading" && (
                <p className="type-caption flex items-center gap-1.5">
                  <Loader2 aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />
                  جارٍ البحث…
                </p>
              )}
              {searchState === "unavailable" && (
                <p className="type-caption">
                  البحث اللحظي غير متاح الآن — أدخل اسم الخادم يدوياً كما يظهر في
                  منصة MT5 لديك (مثال: Exness-MT5Real8).
                </p>
              )}
            </div>

            {servers.length > 0 && (
              <ul className="max-h-48 space-y-1 overflow-y-auto">
                {servers.map((name) => (
                  <li key={name}>
                    <button
                      onClick={() => {
                        setServer(name);
                        setStep("credentials");
                      }}
                      className="min-h-11 w-full rounded-[var(--radius)] border border-border px-3 py-2 text-start text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {name}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="space-y-1.5">
              <label htmlFor="mt5-server" className="type-caption block font-medium">
                أو اكتب اسم الخادم يدوياً
              </label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  id="mt5-server"
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  placeholder="Exness-MT5Real8"
                  className={cn(FIELD, "sm:flex-1")}
                />
                <Button
                  size="lg"
                  className="min-h-11"
                  onClick={() => server.trim() && setStep("credentials")}
                  disabled={!server.trim()}
                >
                  متابعة
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === "credentials" && (
          <div className="space-y-4">
            <h2 className="type-heading">2 · سجّل الدخول إلى حسابك — {server}</h2>

            <div className="flex gap-2.5 rounded-[var(--radius)] border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-foreground">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-500" />
              <p>
                أنت تسجّل الدخول إلى حساب MetaTrader <b>الحقيقي</b> الخاص بك عبر
                سحابة MetaApi المرخّصة. تُخزَّن بيانات الدخول <b>مشفَّرة</b> (AES-256)
                وتُستخدم فقط لتشغيل نسخة الطرفية السحابية الخاصة بك. لخفض التكلفة،
                يُوقَف الاتصال تلقائياً عند مغادرتك المنصة ويعود وحده عند عودتك.
              </p>
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-[var(--radius)] border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="mt5-platform" className="type-caption block font-medium">
                  المنصة
                </label>
                <select
                  id="mt5-platform"
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value as "mt5" | "mt4")}
                  className={FIELD}
                >
                  <option value="mt5">MetaTrader 5</option>
                  <option value="mt4">MetaTrader 4</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="mt5-login" className="type-caption block font-medium">
                  رقم الحساب (Login)
                </label>
                <input
                  id="mt5-login"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder="123456789"
                  inputMode="numeric"
                  autoComplete="off"
                  className={FIELD}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="mt5-password" className="type-caption block font-medium">
                كلمة المرور (Investor أو Master)
              </label>
              <input
                id="mt5-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                autoComplete="off"
                className={FIELD}
              />
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Button
                variant="ghost"
                size="lg"
                className="min-h-11 sm:-ms-2"
                onClick={() => setStep("server")}
              >
                <ArrowLeft aria-hidden="true" className="rtl:rotate-180" />
                تغيير الخادم
              </Button>
              <Button
                size="lg"
                className="min-h-11"
                onClick={connect}
                disabled={!login.trim() || !password}
              >
                ربط الحساب
              </Button>
            </div>
          </div>
        )}

        {(step === "progress" || step === "done") && (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <span
              aria-hidden="true"
              className={cn(
                "flex size-12 items-center justify-center rounded-full border",
                step === "done"
                  ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-500"
                  : "border-border bg-muted text-muted-foreground",
              )}
            >
              {step === "done" ? (
                <CheckCircle2 className="size-6" />
              ) : (
                <Loader2 className="size-6 animate-spin motion-reduce:animate-none" />
              )}
            </span>

            <h2 className="type-heading">
              {step === "done" ? "تم الربط بنجاح" : "3 · جارٍ الربط…"}
            </h2>

            {/* The connect call is slow; announce each status change. */}
            <p className="type-caption" role="status" aria-live="polite">
              {status}
            </p>

            {step === "done" && (
              <a
                href="/console"
                className={cn(buttonVariants({ size: "lg" }), "min-h-11 px-6")}
              >
                الانتقال إلى الشارت
              </a>
            )}
          </div>
        )}
      </Surface>
    </div>
  );
}
