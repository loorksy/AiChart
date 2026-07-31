"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, Cable, Moon, Save, SlidersHorizontal, Sparkles, Sun, User } from "lucide-react";
import { EaConnectCard } from "@/components/settings/EaConnectCard";
import { McpConnectCard } from "@/components/settings/McpConnectCard";
import { UserSkillsPanel } from "@/components/settings/UserSkillsPanel";

import { PageLayout, SurfaceCard } from "@/components/ui/shell";
import { useTheme, type ThemePreference } from "@/components/ThemeProvider";
import { useLocale } from "@/hooks/useLocale";
import type { TranslationKey } from "@/lib/i18n";
import { RISK_PER_TRADE } from "@/lib/productModel";
import { cn } from "@/lib/utils";
import type { AdminLimits, EaConnectionMeta, PublicUser, TradingSettings } from "@/lib/types";

type TabId = "profile" | "subscription" | "appearance" | "integrations" | "alerts" | "trading" | "skills";

const TABS = [
  { id: "profile", labelKey: "settings.tab.account", icon: User },
  { id: "appearance", labelKey: "settings.tab.appearance", icon: Sun },
  { id: "integrations", labelKey: "settings.tab.connections", icon: Cable },
  { id: "alerts", labelKey: "settings.tab.alerts", icon: Bell },
  { id: "trading", labelKey: "settings.trading.risk_label", icon: SlidersHorizontal },
  { id: "skills", labelKey: "skills.title", icon: Sparkles },
] as const satisfies ReadonlyArray<{
  id: TabId;
  labelKey: TranslationKey;
  icon: typeof User;
}>;

export default function SettingsClient({
  user,
  settings: initialSettings,
  limits: _limits,
  ea,
  canDownloadEa = false,
  initialTab,
  embedMode = false,
  visibleTabs,
}: {
  user: PublicUser;
  settings: TradingSettings;
  limits: AdminLimits;
  ea: EaConnectionMeta | null;
  mt?: unknown;
  forexBackend?: unknown;
  mt5LocalAvailable?: boolean;
  metaApiAvailable?: boolean;
  platformConnectAvailable?: boolean;
  canDownloadEa?: boolean;
  initialTab?: TabId;
  embedMode?: boolean;
  visibleTabs?: TabId[];
}) {
  const tabs = visibleTabs ? TABS.filter((item) => visibleTabs.includes(item.id)) : TABS;
  const [tab, setTab] = useState<TabId>(
    initialTab && tabs.some((item) => item.id === initialTab) ? initialTab : tabs[0]?.id ?? "profile",
  );
  const [settings, setSettings] = useState(initialSettings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { theme, setTheme } = useTheme();
  const { t, dir } = useLocale();
  void _limits;

  async function save(patch: Record<string, unknown>) {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t("settings.save_failed"));
      if (data.settings) setSettings(data.settings as TradingSettings);
      setMessage(t("settings.saved"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("settings.save_failed"));
    } finally {
      setSaving(false);
    }
  }

  const content = (
    <div className="space-y-4" dir={dir}>
      {tabs.length > 1 && (
        <nav className="flex gap-2 overflow-x-auto pb-1" aria-label={t("settings.sections")}>
          {tabs.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors",
                  tab === item.id
                    ? "border-foreground bg-foreground text-background"
                    : "border border-border bg-card hover:bg-muted",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {t(item.labelKey)}
              </button>
            );
          })}
        </nav>
      )}

      {tab === "profile" && (
        <SurfaceCard className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">{t("settings.tab.account")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("settings.account.description")}
            </p>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-xl border border-border/60 bg-muted/50 p-3">
              <dt className="text-muted-foreground">{t("settings.email")}</dt>
              <dd className="mt-1 font-medium" dir="ltr">{user.email}</dd>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/50 p-3">
              <dt className="text-muted-foreground">{t("settings.status")}</dt>
              <dd className="mt-1 font-medium">
                {user.status === "active"
                  ? t("settings.status.active")
                  : user.status === "pending"
                    ? t("settings.status.pending")
                    : user.status === "suspended"
                      ? t("settings.status.suspended")
                      : user.status}
              </dd>
            </div>
          </dl>
          <Link href="/console/account" className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-medium transition-colors hover:bg-muted">
            {t("settings.manage_account")}
          </Link>
        </SurfaceCard>
      )}

      {tab === "appearance" && (
        <SurfaceCard>
          <h2 className="text-lg font-semibold">{t("settings.tab.appearance")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("settings.appearance.description")}
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {(["dark", "light", "system"] as ThemePreference[]).map((value) => (
              <button key={value} type="button" onClick={() => setTheme(value)} className={cn("min-h-11 rounded-lg border px-4 text-sm font-medium transition-colors", theme === value ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>
                {value === "dark" ? <Moon className="me-2 inline h-4 w-4" /> : <Sun className="me-2 inline h-4 w-4" />}
                {value === "dark"
                  ? t("profile.theme.dark")
                  : value === "light"
                    ? t("profile.theme.light")
                    : t("settings.theme.system")}
              </button>
            ))}
          </div>
        </SurfaceCard>
      )}

      {tab === "integrations" && (
        <div className="space-y-4">
          <EaConnectCard connection={ea} canDownloadEa={canDownloadEa} />
          <McpConnectCard />
        </div>
      )}

      {tab === "alerts" && (
        <SurfaceCard className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">{t("settings.tab.alerts")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("settings.alerts.description")}
            </p>
          </div>
          {([
            ["alerts_enabled", "settings.alerts.enabled"],
            ["alert_trades", "settings.alerts.trades"],
            ["alert_signals", "settings.alerts.signals"],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex min-h-12 items-center justify-between gap-4 rounded-lg border border-border px-4 transition-colors hover:bg-muted/40">
              <span className="text-sm font-medium">{t(label)}</span>
              <input type="checkbox" className="h-5 w-5 accent-foreground" checked={Boolean(settings[key])} onChange={(event) => setSettings((current) => ({ ...current, [key]: event.target.checked ? 1 : 0 }))} />
            </label>
          ))}
          <button type="button" disabled={saving} onClick={() => void save({ alerts_enabled: Boolean(settings.alerts_enabled), alert_trades: Boolean(settings.alert_trades), alert_signals: Boolean(settings.alert_signals) })} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-60">
            <Save className="h-4 w-4" />
            {t("settings.alerts.save")}
          </button>
        </SurfaceCard>
      )}

      {tab === "skills" && <UserSkillsPanel />}

      {tab === "trading" && (
        <SurfaceCard className="space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("settings.trading.only_setting")}
            </p>
            <h2 className="mt-1 text-xl font-semibold">Risk per Trade</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {t("settings.trading.description")}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <div className="mb-4 flex items-end justify-between gap-4">
              <label htmlFor="risk-per-trade" className="font-medium">
                {t("settings.trading.risk_label")}
              </label>
              <output htmlFor="risk-per-trade" className="text-3xl font-semibold tabular-nums">{settings.per_trade_pct.toFixed(1)}%</output>
            </div>
            <input id="risk-per-trade" type="range" min={RISK_PER_TRADE.min} max={RISK_PER_TRADE.max} step={RISK_PER_TRADE.step} value={settings.per_trade_pct} onChange={(event) => setSettings((current) => ({ ...current, per_trade_pct: Number(event.target.value) }))} className="h-11 w-full cursor-pointer accent-foreground" />
            <div className="flex justify-between text-xs text-muted-foreground"><span>{RISK_PER_TRADE.min}%</span><span>{RISK_PER_TRADE.max}%</span></div>
          </div>
          <button type="button" disabled={saving} onClick={() => void save({ per_trade_pct: settings.per_trade_pct })} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-foreground px-5 text-sm font-semibold text-background disabled:opacity-60">
            <Save className="h-4 w-4" />
            {saving ? t("settings.saving") : t("settings.save")}
          </button>
          {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
        </SurfaceCard>
      )}
    </div>
  );

  return embedMode
    ? content
    : (
        <PageLayout title={t("settings.title")} subtitle={t("settings.subtitle")} maxWidth="6xl">
          {content}
        </PageLayout>
      );
}
