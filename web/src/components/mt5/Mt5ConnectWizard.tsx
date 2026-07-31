"use client";

import { useEffect, useRef, useState } from "react";

interface ExistingAccount {
  platform: string;
  server: string;
  login: string;
  state: string | null;
}

type Step = "server" | "credentials" | "progress" | "done";

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
      <div dir="rtl" className="rounded-xl border border-border bg-card p-6">
        <h1 className="text-xl font-bold text-foreground">ربط حساب MetaTrader 5</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          الربط السحابي غير مفعَّل بعد على هذه المنصة. سيتاح فور اكتمال إعداده —
          وحتى ذلك الحين يمكن استخدام جسر الـ EA كما هو.
        </p>
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">ربط حساب MetaTrader 5</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ربط شفاف عبر سحابة MetaApi — أنت تسجّل الدخول إلى حسابك الحقيقي لدى وسيطك.
        </p>
      </div>

      {existing && step === "server" && (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          حساب مرتبط حالياً: {existing.platform.toUpperCase()} · {existing.login} @{" "}
          {existing.server} — إكمال المعالج يستبدله.
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-6">
        {step === "server" && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-foreground">1 · اختر خادم وسيطك</h2>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث باسم الوسيط (مثال: Exness, IC Markets…)"
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
            />
            {searchState === "loading" && (
              <p className="text-xs text-muted-foreground">جارٍ البحث…</p>
            )}
            {searchState === "unavailable" && (
              <p className="text-xs text-muted-foreground">
                البحث اللحظي غير متاح الآن — أدخل اسم الخادم يدوياً كما يظهر في
                منصة MT5 لديك (مثال: Exness-MT5Real8).
              </p>
            )}
            {servers.length > 0 && (
              <ul className="max-h-48 space-y-1 overflow-y-auto">
                {servers.map((name) => (
                  <li key={name}>
                    <button
                      onClick={() => {
                        setServer(name);
                        setStep("credentials");
                      }}
                      className="w-full rounded-lg border border-border px-3 py-2 text-right text-sm hover:bg-muted"
                    >
                      {name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2">
              <input
                value={server}
                onChange={(e) => setServer(e.target.value)}
                placeholder="أو اكتب اسم الخادم يدوياً"
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
              />
              <button
                onClick={() => server.trim() && setStep("credentials")}
                disabled={!server.trim()}
                className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                متابعة
              </button>
            </div>
          </div>
        )}

        {step === "credentials" && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-foreground">
              2 · سجّل الدخول إلى حسابك — {server}
            </h2>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-foreground">
              أنت تسجّل الدخول إلى حساب MetaTrader <b>الحقيقي</b> الخاص بك عبر
              سحابة MetaApi المرخّصة. تُخزَّن بيانات الدخول <b>مشفَّرة</b> (AES-256)
              وتُستخدم فقط لتشغيل نسخة الطرفية السحابية الخاصة بك. لخفض التكلفة،
              يُوقَف الاتصال تلقائياً عند مغادرتك المنصة ويعود وحده عند عودتك.
            </div>
            {error && (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as "mt5" | "mt4")}
                className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
              >
                <option value="mt5">MetaTrader 5</option>
                <option value="mt4">MetaTrader 4</option>
              </select>
              <input
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                placeholder="رقم الحساب (Login)"
                inputMode="numeric"
                className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
              />
            </div>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="كلمة المرور (Investor أو Master)"
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
            />
            <div className="flex items-center justify-between">
              <button
                onClick={() => setStep("server")}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                ← تغيير الخادم
              </button>
              <button
                onClick={connect}
                disabled={!login.trim() || !password}
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                ربط الحساب
              </button>
            </div>
          </div>
        )}

        {(step === "progress" || step === "done") && (
          <div className="space-y-4 text-center">
            <h2 className="text-sm font-semibold text-foreground">
              {step === "done" ? "تم الربط بنجاح ✓" : "3 · جارٍ الربط…"}
            </h2>
            <p className="text-sm text-muted-foreground">{status}</p>
            {step === "done" && (
              <a
                href="/console"
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground"
              >
                الانتقال إلى الشارت
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
