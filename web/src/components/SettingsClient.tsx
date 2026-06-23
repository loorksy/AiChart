"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  CreditCard,
  LogOut,
  Moon,
  Send,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Sun,
  Trash2,
  User,
} from "lucide-react";
import {
  isOpenAssetsPolicy,
  parseAllowedAssets,
  parseWatchlist,
} from "@/lib/allowedAssets";
import type {
  AdminLimits,
  AlertLog,
  BinanceAccountMeta,
  EaConnectionMeta,
  MtAccountMeta,
  PublicUser,
  TradingSettings,
} from "@/lib/types";
import type { ForexBackendMode } from "@/lib/brokers/forexBackend";
import { EaConnectCard } from "@/components/settings/EaConnectCard";
import { ForexMethodSelector } from "@/components/settings/ForexMethodSelector";
import { MtConnectCard } from "@/components/settings/MtConnectCard";
import { cn } from "@/lib/utils";
import { PageLayout, SurfaceCard, PillButton } from "@/components/ui/shell";
import { useTheme, type ThemePreference } from "@/components/ThemeProvider";
import { displayNameForUser } from "@/lib/displayName";
import { InfoTip, LabelWithTip } from "@/components/ui/InfoTip";

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
  | "alerts"
  | "trading";

const TABS: { id: TabId; label: string; icon: typeof User; desc: string }[] = [
  { id: "profile", label: "الملف الشخصي", icon: User, desc: "بيانات حسابك" },
  { id: "subscription", label: "الاشتراك", icon: CreditCard, desc: "الرصيد والخطة" },
  { id: "appearance", label: "المظهر", icon: Sun, desc: "السمة والعرض" },
  { id: "integrations", label: "الربط والتكامل", icon: Send, desc: "Binance وMetaTrader وتليجرام" },
  { id: "alerts", label: "التنبيهات", icon: Bell, desc: "إشعارات تليجرام والسجل" },
  { id: "trading", label: "التداول والمخاطر", icon: SlidersHorizontal, desc: "الحدود والإعدادات" },
];

export default function SettingsClient({
  user,
  settings: initialSettings,
  limits,
  binance,
  ea,
  mt,
  forexBackend,
  mt5LocalAvailable = false,
  canDownloadEa = false,
  initialTab,
  embedMode = false,
  visibleTabs,
}: {
  user: PublicUser;
  settings: TradingSettings;
  limits: AdminLimits;
  binance: BinanceAccountMeta | null;
  ea: EaConnectionMeta | null;
  mt: MtAccountMeta | null;
  forexBackend: ForexBackendMode;
  mt5LocalAvailable?: boolean;
  canDownloadEa?: boolean;
  initialTab?: TabId;
  /** When true, omit PageLayout — for bridge console sections. */
  embedMode?: boolean;
  /** Restrict which tabs appear; defaults to all. */
  visibleTabs?: TabId[];
}) {
  const allowedTabs = visibleTabs
    ? TABS.filter((t) => visibleTabs.includes(t.id))
    : TABS;
  const defaultTab = initialTab && allowedTabs.some((t) => t.id === initialTab)
    ? initialTab
    : allowedTabs[0]?.id ?? "profile";
  const [tab, setTab] = useState<TabId>(defaultTab);
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const displayName = displayNameForUser(user);

  // Per-user forex connection method: "platform" (server-side, no download) vs
  // "ea" (bridge installed on the user's own MT5). Initialized from the saved
  // preference, falling back to the operator's resolved default.
  const platformAvailable = mt5LocalAvailable || forexBackend === "metaapi";
  // Derive from the RESOLVED effective backend (loader already applied the
  // fallback), so the card shown always matches how execution/data actually
  // route — even when a stored "platform" choice couldn't be honored.
  const [forexMethod, setForexMethod] = useState<"platform" | "ea">(
    forexBackend === "ea" ? "ea" : "platform",
  );
  const [savingForexMethod, setSavingForexMethod] = useState(false);

  async function chooseForexMethod(method: "platform" | "ea") {
    if (method === forexMethod || savingForexMethod) return;
    if (method === "platform" && !platformAvailable) return;
    setSavingForexMethod(true);
    // Preserve an existing MetaApi choice instead of silently downgrading it to
    // mt5local when both server-side backends exist.
    const value =
      method === "ea"
        ? "ea"
        : forexBackend === "metaapi"
          ? "metaapi"
          : mt5LocalAvailable
            ? "mt5local"
            : "metaapi";
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forex_backend: value }),
      });
      if (res.ok) {
        setForexMethod(method);
        router.refresh();
      }
    } finally {
      setSavingForexMethod(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const showTabNav = allowedTabs.length > 1;

  const body = (
    <>
      {/* Mobile: horizontal scrollable tabs */}
      {showTabNav && (
      <div className="-mx-4 overflow-x-auto px-4 md:hidden">
        <div className="flex w-max gap-2 pb-1">
          {allowedTabs.map((t) => {
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
      )}

      <div className={cn("grid gap-4", showTabNav && "md:grid-cols-[1fr_13rem]")}>
        {/* Tab content — يسار في RTL */}
        <div className="min-w-0 space-y-4 md:order-1">
          {tab === "profile" && (
            <SurfaceCard className="space-y-3">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-secondary text-lg font-semibold">
                  {displayName.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h2 className="text-xl font-semibold">{displayName}</h2>
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
                  <h2 className="text-xl font-semibold">الاشتراك</h2>
                  <p className="text-sm text-muted-foreground">
                    الرصيد اليومي: {limits.claude_quota} رسالة
                  </p>
                </div>
              </div>
              <Link href="/console/platform?tab=profile" className="btn btn-primary w-full sm:w-auto">
                <Send className="h-4 w-4" />
                تواصل للاشتراك
              </Link>
            </SurfaceCard>
          )}

          {tab === "appearance" && (
            <SurfaceCard className="space-y-4">
              <h2 className="text-xl font-semibold">المظهر</h2>
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
              <ForexMethodSelector
                method={forexMethod}
                platformAvailable={platformAvailable}
                saving={savingForexMethod}
                onChoose={chooseForexMethod}
              />
              {forexMethod === "platform" ? (
                <MtConnectCard account={mt} />
              ) : (
                <EaConnectCard connection={ea} canDownloadEa={canDownloadEa} />
              )}
              <TelegramCard linked={Boolean(initialSettings.telegram_chat_id)} />
            </div>
          )}

          {tab === "alerts" && (
            <AlertsCard settings={initialSettings} />
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

        {/* تبويبات سطح المكتب — يمين الشاشة في RTL */}
        {showTabNav && (
          <aside className="hidden md:block md:order-2">
            <nav className="sticky top-4 space-y-0.5 rounded-2xl border border-border bg-card p-2">
              {allowedTabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "sidebar-nav-item w-full",
                    tab === t.id && "bg-sidebar-accent",
                  )}
                  data-active={tab === t.id}
                >
                  {t.label}
                </button>
              ))}
              {!embedMode && (
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="sidebar-nav-item mt-2 w-full text-destructive hover:bg-destructive/10"
                >
                  تسجيل الخروج
                </button>
              )}
            </nav>
          </aside>
        )}
      </div>
    </>
  );

  if (embedMode) return body;

  return (
    <PageLayout title="الإعدادات" subtitle="إدارة حسابك وتفضيلاتك" maxWidth="6xl">
      {body}
    </PageLayout>
  );
}

function BinanceCard({ binance }: { binance: BinanceAccountMeta | null }) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [env, setEnv] = useState<"testnet" | "prod">(
    (binance?.env as "testnet" | "prod") ?? "testnet",
  );
  const [region, setRegion] = useState<"global" | "us" | "tr">(
    (binance?.region as "global" | "us" | "tr") ?? "global",
  );
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [permBusy, setPermBusy] = useState(false);
  const [permissionReport, setPermissionReport] = useState<{
    checks: {
      label: string;
      ok: boolean;
      severity: string;
      detail?: string;
    }[];
    withdrawWarning: string | null;
    ipRestrictionAdvice: string | null;
  } | null>(null);

  async function refreshPermissions() {
    if (!binance) return;
    setPermBusy(true);
    try {
      const res = await fetch("/api/binance/status?futuresRequired=1");
      const data = await res.json();
      if (data.connected && data.permissionReport) {
        setPermissionReport(data.permissionReport);
      }
    } catch {
      /* ignore */
    } finally {
      setPermBusy(false);
    }
  }

  useEffect(() => {
    if (binance) void refreshPermissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binance?.env, binance?.updated_at]);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/binance/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, apiSecret, env, region }),
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
      if (data.permissionReport) setPermissionReport(data.permissionReport);
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
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-xl font-semibold">ربط Binance</h2>
        <InfoTip label="أمان المفتاح">
          فعّل التداول فقط وعطّل السحب. على Mainnet فعّل Futures إن احتجت شورت/رافعة.
        </InfoTip>
      </div>

      {binance && (
        <div className="mb-4 space-y-3">
          <div className="flex items-center justify-between rounded-xl bg-secondary px-4 py-3">
            <div className="text-sm">
              <span className="text-accent-gold">● مرتبط</span> —{" "}
              {binance.env === "testnet" ? "تجريبية" : "حقيقية"}
            </div>
            <button onClick={disconnect} className="btn btn-danger py-1.5 text-sm">
              فصل
            </button>
          </div>

          {permissionReport && (
            <div className="rounded-xl border border-border/60 p-3 text-sm">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-medium">صلاحيات المفتاح</p>
                <button
                  type="button"
                  onClick={() => void refreshPermissions()}
                  disabled={permBusy}
                  className="text-xs text-link"
                >
                  {permBusy ? "جارٍ الفحص…" : "إعادة فحص"}
                </button>
              </div>
              <ul className="space-y-1.5">
                {permissionReport.checks.map((c) => (
                  <li key={c.label} className="flex items-start gap-2">
                    <span
                      className={
                        c.ok
                          ? "text-accent-gold"
                          : c.severity === "error"
                            ? "text-destructive"
                            : "text-amber-500"
                      }
                    >
                      {c.ok ? "✓" : "✗"}
                    </span>
                    <span>
                      {c.label}
                      {c.detail ? (
                        <span className="block text-xs text-muted-foreground">
                          {c.detail}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
              {permissionReport.withdrawWarning && (
                <p className="mt-2 text-xs text-destructive">
                  {permissionReport.withdrawWarning}
                </p>
              )}
              {permissionReport.ipRestrictionAdvice && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {permissionReport.ipRestrictionAdvice}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <form onSubmit={connect} className="space-y-4">
        <Field label="منصّة Binance (حسب دولتك)">
          <select
            className="input"
            value={region}
            onChange={(e) => {
              const r = e.target.value as "global" | "us" | "tr";
              setRegion(r);
              if (r !== "global") setEnv("prod"); // US/TR لا تدعمان Testnet
            }}
          >
            <option value="global">عالمي — binance.com</option>
            <option value="tr">تركيا — Binance.TR (binance.tr)</option>
            <option value="us">أمريكا — Binance.US (binance.us)</option>
          </select>
          {region !== "global" && (
            <p className="mt-1 text-xs text-muted-foreground">
              استخدم مفتاحاً مولّداً من نفس المنصّة. القراءة فقط مدعومة الآن لـ
              {region === "tr" ? " Binance.TR" : " Binance.US"}.
            </p>
          )}
        </Field>
        <Field label="البيئة">
          <select
            className="input"
            value={env}
            onChange={(e) => setEnv(e.target.value as "testnet" | "prod")}
            disabled={region !== "global"}
          >
            {region === "global" && (
              <option value="testnet">تجريبية (Testnet)</option>
            )}
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
      <h2 className="mb-1 text-xl font-semibold">إشعارات تليجرام</h2>
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

function ToggleRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-xl bg-secondary px-4 py-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {desc && (
          <span className="block text-xs text-muted-foreground">{desc}</span>
        )}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 rounded border-border"
      />
    </label>
  );
}

const ALERT_TYPE_LABEL: Record<string, string> = {
  trade_executed: "تنفيذ صفقة",
  trade_closed: "إغلاق صفقة",
  trade_failed: "تعذّر التنفيذ",
  signal: "إشارة تداول",
};

function AlertsCard({ settings }: { settings: TradingSettings }) {
  const router = useRouter();
  const [s, setS] = useState(settings);
  const [log, setLog] = useState<AlertLog[]>([]);
  const [loadingLog, setLoadingLog] = useState(true);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  function loadLog() {
    setLoadingLog(true);
    void fetch("/api/alerts")
      .then((r) => r.json())
      .then((d) => setLog(Array.isArray(d.alerts) ? d.alerts : []))
      .catch(() => {})
      .finally(() => setLoadingLog(false));
  }

  useEffect(() => {
    loadLog();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alerts_enabled: Boolean(s.alerts_enabled),
          alert_trades: Boolean(s.alert_trades),
          alert_signals: Boolean(s.alert_signals),
          alert_min_confidence: Number(s.alert_min_confidence),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "err", text: data.error ?? "فشل الحفظ." });
        return;
      }
      setMsg({ type: "ok", text: "تم حفظ تفضيلات التنبيهات." });
      router.refresh();
    } catch {
      setMsg({ type: "err", text: "تعذّر الاتصال بالخادم." });
    } finally {
      setBusy(false);
    }
  }

  async function clearLog() {
    if (!confirm("مسح سجل التنبيهات بالكامل؟")) return;
    await fetch("/api/alerts", { method: "DELETE" });
    setLog([]);
  }

  const master = Boolean(s.alerts_enabled);

  return (
    <div className="space-y-4">
      <SurfaceCard>
        <h2 className="mb-1 text-xl font-semibold">تفضيلات التنبيهات</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          تحكّم في ما يصلك عبر تليجرام.
        </p>

        <form onSubmit={save} className="space-y-3">
          <ToggleRow
            label="تفعيل التنبيهات"
            desc="المفتاح الرئيسي لكل الإشعارات"
            checked={master}
            onChange={(v) =>
              setS((p) => ({ ...p, alerts_enabled: v ? 1 : 0 }))
            }
          />

          <div
            className={cn(
              "space-y-3 transition",
              !master && "pointer-events-none opacity-50",
            )}
          >
            <ToggleRow
              label="تنبيهات الصفقات"
              desc="عند تنفيذ أو إغلاق أو تعذّر صفقة"
              checked={Boolean(s.alert_trades)}
              onChange={(v) =>
                setS((p) => ({ ...p, alert_trades: v ? 1 : 0 }))
              }
            />
            <ToggleRow
              label="تنبيهات إشارات الوكيل"
              desc="عند توليد توصية تداول جديدة"
              checked={Boolean(s.alert_signals)}
              onChange={(v) =>
                setS((p) => ({ ...p, alert_signals: v ? 1 : 0 }))
              }
            />

            <Field label={`أدنى ثقة للإشارة · ${s.alert_min_confidence}%`}>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={s.alert_min_confidence}
                onChange={(e) =>
                  setS((p) => ({
                    ...p,
                    alert_min_confidence: Number(e.target.value),
                  }))
                }
                className="w-full accent-primary"
                disabled={!s.alert_signals}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                يتم تجاهل الإشارات الأقل من هذه الثقة.
              </p>
            </Field>
          </div>

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
            {busy ? "جارٍ الحفظ…" : "حفظ"}
          </button>
        </form>
      </SurfaceCard>

      <SurfaceCard>
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">سجل التنبيهات</h2>
          {log.length > 0 && (
            <button
              type="button"
              onClick={() => void clearLog()}
              className="btn btn-danger py-1.5 text-sm"
            >
              <Trash2 className="h-4 w-4" />
              مسح
            </button>
          )}
        </div>

        {loadingLog ? (
          <p className="text-sm text-muted-foreground">جارٍ التحميل…</p>
        ) : log.length === 0 ? (
          <div className="rounded-xl bg-secondary p-6 text-center text-sm text-muted-foreground">
            لا توجد تنبيهات بعد.
          </div>
        ) : (
          <ul className="space-y-2">
            {log.map((a) => (
              <li
                key={a.id}
                className="rounded-xl border border-border bg-card px-4 py-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Bell className="h-3.5 w-3.5 text-accent-gold" />
                    {a.title}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px]",
                      a.delivered
                        ? "bg-primary/10 text-primary"
                        : "bg-secondary text-muted-foreground",
                    )}
                  >
                    {a.delivered ? "أُرسل" : "غير مُرسل"}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{ALERT_TYPE_LABEL[a.type] ?? a.type}</span>
                  {a.symbol && <span dir="ltr">· {a.symbol}</span>}
                  <span dir="ltr">· {a.created_at}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SurfaceCard>
    </div>
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
    isOpenAssetsPolicy(settings.allowed_assets, "crypto"),
  );
  const [assets, setAssets] = useState(
    parseAllowedAssets(settings.allowed_assets, "crypto").join(", "),
  );
  const [forexOpen, setForexOpen] = useState(
    isOpenAssetsPolicy(settings.allowed_assets, "forex"),
  );
  const [forexAssets, setForexAssets] = useState(
    parseAllowedAssets(settings.allowed_assets, "forex").join(", "),
  );
  const [watchlist, setWatchlist] = useState(
    parseWatchlist(settings.allowed_assets).join(", "),
  );
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const parseCsv = (v: string) =>
    v
      .split(",")
      .map((a) => a.trim().toUpperCase())
      .filter(Boolean);

  // Approval is derived from the mode: auto delegates, the rest are manual.
  const effectiveApproval = s.mode === "auto" ? "delegate" : "manual";

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
          daily_profit_target_usd: Number(s.daily_profit_target_usd ?? 0),
          daily_loss_limit_pct: Number(s.daily_loss_limit_pct),
          monthly_loss_limit_pct: Number(s.monthly_loss_limit_pct),
          auto_take_profit_usd: Number(s.auto_take_profit_usd ?? 0),
          allowed_assets: {
            crypto: openAssets ? [] : parseCsv(assets),
            forex: forexOpen ? [] : parseCsv(forexAssets),
            watchlist: parseCsv(watchlist),
          },
          send_screenshot: Boolean(s.send_screenshot),
          scan_poll_minutes: Number(s.scan_poll_minutes ?? 0),
          analysis_interval: s.analysis_interval ?? "1h",
          execution_env_preference:
            s.execution_env_preference === "live" ? "live" : "demo",
          telegram_chat_id: s.telegram_chat_id || null,
          kill_switch: Boolean(s.kill_switch),
          futures_enabled: Boolean(s.futures_enabled),
          default_leverage: Number(s.default_leverage ?? 3),
          min_confidence: Number(s.min_confidence ?? 80),
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
      <h2 className="mb-1 text-xl font-semibold">التداول والمخاطر</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        حدود تُفرض قبل أي صفقة.
      </p>

      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="بيئة التنفيذ المفضّلة">
          <select
            className="input"
            value={s.execution_env_preference === "live" ? "live" : "demo"}
            onChange={(e) =>
              set(
                "execution_env_preference",
                e.target.value as "demo" | "live",
              )
            }
          >
            <option value="demo">تجريبي (ديمو / Testnet)</option>
            <option value="live">حقيقي (Live / Prod)</option>
          </select>
        </Field>
        <Field label="الوضع">
          <select
            className="input"
            value={s.mode}
            onChange={(e) => {
              const mode = e.target.value as TradingSettings["mode"];
              set("mode", mode);
              set("approval", mode === "auto" ? "delegate" : "manual");
            }}
          >
            <option value="approval">موافقة يدوية — الوكيل يقترح وأنت توافق</option>
            <option value="direct">مباشر — التنفيذ بأمرك الصريح فقط</option>
            <option value="auto" disabled={!limits.can_execute}>
              تلقائي — الوكيل يتداول وحده ضمن الحدود
            </option>
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

        <Field label="الحد الأقصى للصفقات المفتوحة">
          <input
            type="number"
            min={1}
            max={50}
            step={1}
            className="input"
            value={s.max_open_trades}
            onChange={(e) => set("max_open_trades", Number(e.target.value))}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            سقف الأدمن: {limits.max_open_trades_cap} صفقة
          </p>
          {s.max_open_trades > limits.max_open_trades_cap && (
            <p className="mt-1 text-xs text-destructive">
              القيمة أعلى من سقف الأدمن — سيُخفَّض تلقائياً عند الحفظ.
            </p>
          )}
        </Field>

        <Field label="هدف الربح اليومي (%)">
          <input
            type="number"
            min={0}
            max={1000}
            step={0.5}
            className="input"
            value={s.daily_profit_target_pct}
            onChange={(e) =>
              set("daily_profit_target_pct", Number(e.target.value))
            }
          />
          <p className="mt-1 text-xs text-muted-foreground">
            0 = معطّل. عند بلوغ الهدف تتوقّف الصفقات الجديدة لليوم.
          </p>
        </Field>

        <Field label="هدف الربح اليومي (USDT)">
          <input
            type="number"
            min={0}
            step={1}
            className="input"
            value={s.daily_profit_target_usd ?? 0}
            onChange={(e) =>
              set("daily_profit_target_usd", Number(e.target.value))
            }
          />
          <p className="mt-1 text-xs text-muted-foreground">
            0 = معطّل. يُحسب من أرباح الصفقات المغلقة اليوم.
          </p>
        </Field>

        <Field label="حد الخسارة اليومي (%)">
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            className="input"
            value={s.daily_loss_limit_pct}
            onChange={(e) =>
              set("daily_loss_limit_pct", Number(e.target.value))
            }
          />
        </Field>

        <Field label="حد الخسارة الشهري (%)">
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            className="input"
            value={s.monthly_loss_limit_pct}
            onChange={(e) =>
              set("monthly_loss_limit_pct", Number(e.target.value))
            }
          />
        </Field>

        <Field label="إغلاق تلقائي عند ربح (USDT)">
          <input
            type="number"
            min={0}
            step={0.5}
            className="input"
            value={s.auto_take_profit_usd ?? 0}
            onChange={(e) =>
              set("auto_take_profit_usd", Number(e.target.value))
            }
          />
          <p className="mt-1 text-xs text-muted-foreground">
            0 = معطّل. يُغلق الصفقة عند تحقيق ربح غير محقّق بهذا المبلغ (لا يعمل مع OCO نشط).
          </p>
        </Field>

        <div>
          <LabelWithTip
            label="Futures"
            tip="Binance USDT-M: شورت + رافعة. هامش معزول ووقف خسارة إلزامي — الخسارة القصوى = هامش الصفقة."
          />
          <select
            className="input mt-1"
            value={s.futures_enabled ? "on" : "off"}
            onChange={(e) =>
              set("futures_enabled", e.target.value === "on" ? 1 : 0)
            }
          >
            <option value="off">معطّل</option>
            <option value="on">مفعّل</option>
          </select>
        </div>

        <div>
          <LabelWithTip
            label="الرافعة"
            tip={`الافتراضي للصفقات الجديدة. سقف الأدمن: ${limits.max_leverage_cap && limits.max_leverage_cap > 0 ? limits.max_leverage_cap : 10}x`}
          />
          <input
            type="number"
            min={1}
            max={limits.max_leverage_cap && limits.max_leverage_cap > 0 ? limits.max_leverage_cap : 10}
            step={1}
            className="input mt-1"
            value={s.default_leverage ?? 3}
            onChange={(e) => set("default_leverage", Number(e.target.value))}
            disabled={!s.futures_enabled}
          />
        </div>

        <Field label={`الحد الأدنى لثقة التنفيذ · ${s.min_confidence ?? 80}%`}>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={s.min_confidence ?? 80}
            onChange={(e) => set("min_confidence", Number(e.target.value))}
            className="w-full accent-primary"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            تُنفذ الصفقات تلقائياً فقط إذا تجاوزت ثقة الوكيل هذه النسبة (في البيئة الحقيقية).
          </p>
        </Field>

        <Field label="إطار المسح الافتراضي">
          <select
            className="input"
            value={s.analysis_interval ?? "1h"}
            onChange={(e) => set("analysis_interval", e.target.value)}
          >
            <option value="15m">15 دقيقة</option>
            <option value="1h">1 ساعة</option>
            <option value="4h">4 ساعات</option>
            <option value="1d">يوم</option>
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            يُستخدم في «ابحث عن صفقة» والمسح التلقائي عند عدم اختيار إطار من
            الشارت.
          </p>
        </Field>

        <Field label="مسح تلقائي أثناء الجلسة (دقيقة)">
          <select
            className="input"
            value={s.scan_poll_minutes ?? 0}
            onChange={(e) =>
              set("scan_poll_minutes", Number(e.target.value))
            }
          >
            <option value={0}>معطّل</option>
            <option value={5}>كل 5 دقائق</option>
            <option value={15}>كل 15 دقيقة</option>
            <option value={30}>كل 30 دقيقة</option>
          </select>
        </Field>

        <div className="sm:col-span-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(s.send_screenshot)}
              onChange={(e) =>
                set("send_screenshot", e.target.checked ? 1 : 0)
              }
              className="rounded border-border"
            />
            <span>إرسال صورة الشارت مع التوصيات (تليجرام والموقع)</span>
          </label>
        </div>

        <div className="sm:col-span-2 space-y-4">
          <div className="space-y-2 rounded-xl border border-border/60 p-3">
            <p className="text-sm font-medium">الأصول المسموحة · كريبتو (Binance)</p>
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
            <Field label="قائمة المسح (watchlist) — 5–20 زوج للبحث عن صفقة">
              <input
                className="input"
                dir="ltr"
                value={watchlist}
                onChange={(e) => setWatchlist(e.target.value)}
                placeholder="BTCUSDT, ETHUSDT, SOLUSDT (فارغ = أفضل الأزواج حسب الحجم)"
              />
            </Field>
          </div>

          <div className="space-y-2 rounded-xl border border-border/60 p-3">
            <p className="text-sm font-medium">الأصول المسموحة · فوركس (MetaTrader)</p>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={forexOpen}
                onChange={(e) => setForexOpen(e.target.checked)}
                className="rounded border-border"
              />
              <span>كل أزواج الفوركس المتاحة لدى الوسيط</span>
            </label>
            {!forexOpen && (
              <Field label="قائمة مخصّصة (اختياري)">
                <input
                  className="input"
                  dir="ltr"
                  value={forexAssets}
                  onChange={(e) => setForexAssets(e.target.value)}
                  placeholder="EURUSD, XAUUSD, GBPUSD"
                />
              </Field>
            )}
          </div>
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
