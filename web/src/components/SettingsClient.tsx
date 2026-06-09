"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CreditCard,
  LogOut,
  Moon,
  Send,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Sun,
  User,
} from "lucide-react";
import {
  isOpenAssetsPolicy,
  parseAllowedAssets,
} from "@/lib/allowedAssets";
import type {
  AdminLimits,
  BinanceAccountMeta,
  PublicUser,
  TradingSettings,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { SurfaceCard, PillButton } from "@/components/ui/shell";
import { useTheme, type ThemePreference } from "@/components/ThemeProvider";
import { displayNameFromEmail } from "@/lib/displayName";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label>{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

type TabId =
  | "profile"
  | "subscription"
  | "appearance"
  | "integrations"
  | "trading";

const TABS: { id: TabId; label: string; icon: typeof User; desc: string }[] = [
  { id: "profile", label: "الملف الشخصي", icon: User, desc: "بيانات حسابك" },
  { id: "subscription", label: "الاشتراك", icon: CreditCard, desc: "الرصيد والخطة" },
  { id: "appearance", label: "المظهر", icon: Sun, desc: "السمة والعرض" },
  { id: "integrations", label: "الربط والتكامل", icon: Send, desc: "Binance وتليجرام" },
  { id: "trading", label: "التداول والمخاطر", icon: SlidersHorizontal, desc: "الحدود والإعدادات" },
];

export default function SettingsClient({
  user,
  settings: initialSettings,
  limits,
  binance,
}: {
  user: PublicUser;
  settings: TradingSettings;
  limits: AdminLimits;
  binance: BinanceAccountMeta | null;
}) {
  const [tab, setTab] = useState<TabId>("profile");
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const displayName = displayNameFromEmail(user.email);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <main className="page-shell max-w-5xl space-y-4">
      <div>
        <h1 className="page-title">الإعدادات</h1>
        <p className="page-subtitle">إدارة حسابك وتفضيلاتك</p>
      </div>

      {/* Mobile: horizontal scrollable tabs */}
      <div className="-mx-4 overflow-x-auto px-4 md:hidden">
        <div className="flex w-max gap-2 pb-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium transition",
                  tab === t.id
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
        {/* Desktop: vertical tab list */}
        <aside className="hidden md:block">
          <SurfaceCard padding="sm" className="space-y-1">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start transition",
                    tab === t.id
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-secondary/50",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-xl",
                      tab === t.id ? "bg-primary/10" : "bg-secondary",
                    )}
                  >
                    <Icon className="h-4 w-4 text-accent-gold" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{t.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t.desc}
                    </span>
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => void logout()}
              className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start text-destructive transition hover:bg-destructive/5"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-destructive/10">
                <LogOut className="h-4 w-4" />
              </span>
              <span className="text-sm font-medium">تسجيل الخروج</span>
            </button>
          </SurfaceCard>
        </aside>

        {/* Tab content */}
        <div className="min-w-0 space-y-4">
          {tab === "profile" && (
            <SurfaceCard className="space-y-3">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 font-serif text-lg font-bold text-primary">
                  {displayName.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h2 className="font-serif text-xl font-bold">{displayName}</h2>
                  <p className="truncate text-sm text-muted-foreground" dir="ltr">
                    {user.email}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                <span className="rounded-full bg-secondary px-3 py-1">
                  الحالة:{" "}
                  <span className="font-medium">
                    {user.status === "active"
                      ? "مفعّل"
                      : user.status === "pending"
                        ? "بانتظار الموافقة"
                        : "موقوف"}
                  </span>
                </span>
                <span className="rounded-full bg-secondary px-3 py-1">
                  الدور: {user.role === "admin" ? "مدير" : "متداول"}
                </span>
              </div>
            </SurfaceCard>
          )}

          {tab === "subscription" && (
            <SurfaceCard className="space-y-3">
              <div className="flex items-start gap-3">
                <CreditCard className="mt-0.5 h-5 w-5 text-accent-gold" />
                <div>
                  <h2 className="font-serif text-xl font-bold">الاشتراك</h2>
                  <p className="text-sm text-muted-foreground">
                    الرصيد اليومي: {limits.claude_quota} رسالة
                  </p>
                </div>
              </div>
              <Link href="/plan" className="btn btn-primary w-full sm:w-auto">
                <Send className="h-4 w-4" />
                تواصل للاشتراك
              </Link>
            </SurfaceCard>
          )}

          {tab === "appearance" && (
            <SurfaceCard className="space-y-4">
              <h2 className="font-serif text-xl font-bold">المظهر</h2>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { id: "light" as const, label: "فاتح", icon: Sun },
                    { id: "dark" as const, label: "داكن", icon: Moon },
                    { id: "system" as const, label: "تلقائي", icon: SettingsIcon },
                  ] as const
                ).map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <PillButton
                      key={opt.id}
                      variant={theme === opt.id ? "primary" : "outline"}
                      onClick={() => setTheme(opt.id as ThemePreference)}
                      className="gap-2"
                    >
                      <Icon className="h-4 w-4" />
                      {opt.label}
                    </PillButton>
                  );
                })}
              </div>
            </SurfaceCard>
          )}

          {tab === "integrations" && (
            <div className="space-y-4">
              <BinanceCard binance={binance} />
              <TelegramCard linked={Boolean(initialSettings.telegram_chat_id)} />
            </div>
          )}

          {tab === "trading" && (
            <TradingCard settings={initialSettings} limits={limits} />
          )}

          {/* Mobile-only logout */}
          <button
            type="button"
            onClick={() => void logout()}
            className="w-full md:hidden"
          >
            <SurfaceCard className="flex items-center gap-3 text-destructive transition hover:bg-destructive/5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10">
                <LogOut className="h-5 w-5" />
              </div>
              <p className="font-medium">تسجيل الخروج</p>
            </SurfaceCard>
          </button>
        </div>
      </div>
    </main>
  );
}

function BinanceCard({ binance }: { binance: BinanceAccountMeta | null }) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [env, setEnv] = useState<"testnet" | "prod">(
    (binance?.env as "testnet" | "prod") ?? "testnet",
  );
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/binance/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, apiSecret, env }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "err", text: data.error ?? "فشل الربط." });
        return;
      }
      setApiKey("");
      setApiSecret("");
      setMsg({
        type: "ok",
        text: data.withdrawWarning
          ? `تم الربط بنجاح. ${data.withdrawWarning}`
          : "تم الربط والتحقق بنجاح.",
      });
      router.refresh();
    } catch {
      setMsg({ type: "err", text: "تعذّر الاتصال بالخادم." });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm("هل تريد فصل حساب Binance؟")) return;
    await fetch("/api/binance", { method: "DELETE" });
    router.refresh();
  }

  return (
    <SurfaceCard>
      <h2 className="mb-1 font-serif text-xl font-bold">ربط Binance</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        فعّل صلاحية التداول فقط، وعطّل السحب.
      </p>

      {binance && (
        <div className="mb-4 flex items-center justify-between rounded-xl bg-secondary px-4 py-3">
          <div className="text-sm">
            <span className="text-accent-gold">● مرتبط</span> —{" "}
            {binance.env === "testnet" ? "تجريبية" : "حقيقية"}
          </div>
          <button onClick={disconnect} className="btn btn-danger py-1.5 text-sm">
            فصل
          </button>
        </div>
      )}

      <form onSubmit={connect} className="space-y-4">
        <Field label="البيئة">
          <select
            className="input"
            value={env}
            onChange={(e) => setEnv(e.target.value as "testnet" | "prod")}
          >
            <option value="testnet">تجريبية (Testnet)</option>
            <option value="prod">حقيقية (Mainnet)</option>
          </select>
        </Field>
        <Field label="API Key">
          <input
            className="input"
            dir="ltr"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="مفتاح API"
          />
        </Field>
        <Field label="API Secret">
          <input
            type="password"
            className="input"
            dir="ltr"
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
            placeholder="السر"
          />
        </Field>

        {msg && (
          <p
            className={`rounded-lg px-3 py-2 text-sm ${
              msg.type === "ok"
                ? "bg-secondary text-foreground"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            {msg.text}
          </p>
        )}

        <button className="btn btn-primary" disabled={busy}>
          {busy ? "جارٍ التحقق…" : binance ? "تحديث المفاتيح" : "ربط وتحقق"}
        </button>
      </form>
    </SurfaceCard>
  );
}

function TelegramCard({ linked }: { linked: boolean }) {
  const router = useRouter();
  const [botLink, setBotLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/telegram/link")
      .then((r) => r.json())
      .then((d) => {
        if (d.botUsername) {
          setBotLink(`https://t.me/${d.botUsername}?start=welcome`);
        }
      })
      .catch(() => {});
  }, []);

  async function unlink() {
    if (!confirm("فصل حساب تليجرام؟")) return;
    setBusy(true);
    try {
      await fetch("/api/telegram/link", { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <SurfaceCard>
      <h2 className="mb-1 font-serif text-xl font-bold">إشعارات تليجرام</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        إشعارات الصفقات وأزرار الموافقة.
      </p>

      {linked ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-xl bg-secondary px-4 py-3">
            <span className="text-sm">
              <span className="text-accent-gold">● مرتبط</span>
            </span>
            <button
              onClick={unlink}
              disabled={busy}
              className="btn btn-danger py-1.5 text-sm"
            >
              فصل
            </button>
          </div>
          {botLink && (
            <a href={botLink} target="_blank" rel="noreferrer" className="text-link text-sm">
              افتح البوت ←
            </a>
          )}
        </div>
      ) : (
        <div className="rounded-xl bg-secondary p-4 text-sm text-muted-foreground">
          <Link href="/login" className="text-link underline">
            سجّل الدخول عبر تليجرام
          </Link>
        </div>
      )}
    </SurfaceCard>
  );
}

function TradingCard({
  settings,
  limits,
}: {
  settings: TradingSettings;
  limits: AdminLimits;
}) {
  const router = useRouter();
  const [s, setS] = useState(settings);
  const [openAssets, setOpenAssets] = useState(
    isOpenAssetsPolicy(settings.allowed_assets),
  );
  const [assets, setAssets] = useState(
    parseAllowedAssets(settings.allowed_assets).join(", "),
  );
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const canDelegate = limits.can_execute && s.mode === "auto";
  const effectiveApproval =
    s.approval === "delegate" && !canDelegate ? "manual" : s.approval;

  function set<K extends keyof TradingSettings>(k: K, v: TradingSettings[K]) {
    setS((prev) => ({ ...prev, [k]: v }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: s.mode,
          approval: effectiveApproval,
          experience: s.experience,
          style: s.style,
          max_capital: Number(s.max_capital),
          per_trade_pct: Number(s.per_trade_pct),
          max_open_trades: Number(s.max_open_trades),
          daily_profit_target_pct: Number(s.daily_profit_target_pct),
          daily_loss_limit_pct: Number(s.daily_loss_limit_pct),
          monthly_loss_limit_pct: Number(s.monthly_loss_limit_pct),
          allowed_assets: openAssets
            ? []
            : assets
                .split(",")
                .map((a) => a.trim().toUpperCase())
                .filter(Boolean),
          send_screenshot: Boolean(s.send_screenshot),
          telegram_chat_id: s.telegram_chat_id || null,
          kill_switch: Boolean(s.kill_switch),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "err", text: data.error ?? "فشل الحفظ." });
        return;
      }
      setMsg({ type: "ok", text: data.capped ?? "تم حفظ الإعدادات." });
      router.refresh();
    } catch {
      setMsg({ type: "err", text: "تعذّر الاتصال بالخادم." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SurfaceCard>
      <h2 className="mb-1 font-serif text-xl font-bold">التداول والمخاطر</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        حدود تُفرض قبل أي صفقة.
      </p>

      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="الوضع">
          <select
            className="input"
            value={s.mode}
            onChange={(e) => {
              const mode = e.target.value as TradingSettings["mode"];
              set("mode", mode);
              if (mode !== "auto" && s.approval === "delegate") {
                set("approval", "manual");
              }
            }}
          >
            <option value="advisory">توصيات فقط</option>
            <option value="auto" disabled={!limits.can_execute}>
              تنفيذ تلقائي
            </option>
          </select>
        </Field>

        <Field label="الموافقة على الصفقات">
          <select
            className="input"
            value={effectiveApproval}
            onChange={(e) =>
              set("approval", e.target.value as TradingSettings["approval"])
            }
          >
            <option value="manual">تأكيد يدوي لكل صفقة</option>
            {canDelegate && (
              <option value="delegate">تفويض تلقائي ضمن الحدود</option>
            )}
          </select>
        </Field>

        <Field label="أسلوب التداول">
          <select
            className="input"
            value={s.style}
            onChange={(e) => set("style", e.target.value as TradingSettings["style"])}
          >
            <option value="conservative">محافظ</option>
            <option value="balanced">متوازن</option>
            <option value="aggressive">نشِط</option>
          </select>
        </Field>

        <Field label="سقف رأس المال (USDT)">
          <input
            type="number"
            min={0}
            className="input"
            value={s.max_capital}
            onChange={(e) => set("max_capital", Number(e.target.value))}
          />
        </Field>

        <Field label="حجم الصفقة %">
          <input
            type="number"
            min={0.1}
            max={100}
            step={0.1}
            className="input"
            value={s.per_trade_pct}
            onChange={(e) => set("per_trade_pct", Number(e.target.value))}
          />
        </Field>

        <div className="sm:col-span-2 space-y-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={openAssets}
              onChange={(e) => setOpenAssets(e.target.checked)}
              className="rounded border-border"
            />
            <span>
              جميع أزواج USDT على Binance (تحديث تلقائي عند إدراج أزواج جديدة)
            </span>
          </label>
          {!openAssets && (
            <Field label="قائمة مخصّصة (اختياري)">
              <input
                className="input"
                dir="ltr"
                value={assets}
                onChange={(e) => setAssets(e.target.value)}
                placeholder="BTCUSDT, ETHUSDT, SOLUSDT"
              />
            </Field>
          )}
        </div>

        <div className="sm:col-span-2">
          {msg && (
            <p
              className={`mb-3 rounded-lg px-3 py-2 text-sm ${
                msg.type === "ok"
                  ? "bg-secondary text-foreground"
                  : "bg-destructive/10 text-destructive"
              }`}
            >
              {msg.text}
            </p>
          )}
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "جارٍ الحفظ…" : "حفظ"}
          </button>
        </div>
      </form>
    </SurfaceCard>
  );
}
