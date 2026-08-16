"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, Cable, Moon, Save, Sparkles, Sun, User } from "lucide-react";
import { McpConnectCard } from "@/components/settings/McpConnectCard";
import { TelegramLinkCard } from "@/components/settings/TelegramLinkCard";
import { UserSkillsPanel } from "@/components/settings/UserSkillsPanel";
import { AgentMemoryPanel } from "@/components/settings/AgentMemoryPanel";

import { PageHeader, Surface } from "@/components/foundation";
import { Button, buttonVariants } from "@/components/squareui/button";
import { Checkbox } from "@/components/squareui/checkbox";
import { useTheme, type ThemePreference } from "@/components/ThemeProvider";
import { useLocale } from "@/hooks/useLocale";
import type { TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { AdminLimits, MtAccountMeta, PublicUser, TradingSettings } from "@/lib/types";

type TabId = "profile" | "subscription" | "appearance" | "integrations" | "alerts" | "skills";

/**
 * Ordered by how often a trader actually opens each one, not by how the ids
 * happened to be declared. Risk per Trade is not here: it sizes the next
 * position, so it belongs in the composer beside the send button, not two
 * navigations away.
 */
export const TABS = [
  { id: "profile", labelKey: "settings.tab.account", icon: User },
  { id: "alerts", labelKey: "settings.tab.alerts", icon: Bell },
  { id: "appearance", labelKey: "settings.tab.appearance", icon: Sun },
  { id: "integrations", labelKey: "settings.tab.connections", icon: Cable },
  { id: "skills", labelKey: "skills.title", icon: Sparkles },
] as const satisfies ReadonlyArray<{
  id: TabId;
  labelKey: TranslationKey;
  icon: typeof User;
}>;

export type SettingsTabId = TabId;

export default function SettingsClient({
  user,
  settings: initialSettings,
  limits: _limits,
  mt5LinkEnabled = false,
  mt5Account = null,
  initialTab,
  embedMode = false,
  visibleTabs,
  tab: controlledTab,
  onTabChange,
  onDirtyChange,
}: {
  user: PublicUser;
  settings: TradingSettings;
  limits: AdminLimits;
  mt?: unknown;
  mt5LinkEnabled?: boolean;
  mt5Account?: MtAccountMeta | null;
  initialTab?: TabId;
  embedMode?: boolean;
  visibleTabs?: TabId[];
  /** Controlled tab. When set, the host owns navigation and the pill row hides. */
  tab?: TabId;
  onTabChange?: (tab: TabId) => void;
  /** Fires when local edits diverge from (or return to) what the server holds. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const tabs = visibleTabs ? TABS.filter((item) => visibleTabs.includes(item.id)) : TABS;
  const [uncontrolledTab, setTab] = useState<TabId>(
    initialTab && tabs.some((item) => item.id === initialTab) ? initialTab : tabs[0]?.id ?? "profile",
  );
  const tab = controlledTab ?? uncontrolledTab;
  const [settings, setSettings] = useState(initialSettings);
  const [saved, setSaved] = useState(initialSettings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { theme, setTheme } = useTheme();
  const { t, dir } = useLocale();
  void _limits;

  /**
   * Edits live here until their section's Save button lands them, so switching
   * tabs must not be what discards them. Reporting dirtiness upward lets a host
   * (the settings modal) refuse to close on top of unsaved input.
   */
  const dirty =
    Boolean(settings.alerts_enabled) !== Boolean(saved.alerts_enabled) ||
    Boolean(settings.alert_trades) !== Boolean(saved.alert_trades) ||
    Boolean(settings.alert_signals) !== Boolean(saved.alert_signals);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

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
      if (data.settings) {
        setSettings(data.settings as TradingSettings);
        setSaved(data.settings as TradingSettings);
      } else {
        setSaved(settings);
      }
      setMessage(t("settings.saved"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("settings.save_failed"));
    } finally {
      setSaving(false);
    }
  }

  const content = (
    <div className="space-y-4" dir={dir}>
      {controlledTab === undefined && tabs.length > 1 && (
        <nav className="flex gap-1.5 overflow-x-auto pb-1" aria-label={t("settings.sections")}>
          {tabs.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTab(item.id);
                  onTabChange?.(item.id);
                }}
                aria-current={tab === item.id ? "true" : undefined}
                className={cn(
                  "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium transition-colors focus-ring sm:min-h-9",
                  tab === item.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
        <Surface padding="lg" className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">{t("settings.tab.account")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("settings.account.description")}
            </p>
          </div>
          {/* Insets, not cards-in-cards: borderless muted panels only. */}
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-[var(--radius)] bg-muted/50 p-3">
              <dt className="text-muted-foreground">{t("settings.email")}</dt>
              <dd className="mt-1 font-medium" dir="ltr">{user.email}</dd>
            </div>
            <div className="rounded-[var(--radius)] bg-muted/50 p-3">
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
          <Link
            href="/console/settings"
            className={cn(buttonVariants({ variant: "outline", size: "xl" }))}
          >
            {t("settings.manage_account")}
          </Link>
          {/* Memory transparency (plan Phase 4): everything the agent
              remembers, visible and revocable, next to the account facts. */}
          <AgentMemoryPanel />
        </Surface>
      )}

      {tab === "appearance" && (
        <Surface padding="lg">
          <h2 className="text-lg font-semibold">{t("settings.tab.appearance")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("settings.appearance.description")}
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {(["dark", "light", "system"] as ThemePreference[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTheme(value)}
                aria-pressed={theme === value}
                className={cn(
                  "min-h-11 rounded-md border px-4 text-sm font-medium transition-colors focus-ring",
                  theme === value
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-muted",
                )}
              >
                {value === "dark" ? <Moon className="me-2 inline h-4 w-4" aria-hidden /> : <Sun className="me-2 inline h-4 w-4" aria-hidden />}
                {value === "dark"
                  ? t("profile.theme.dark")
                  : value === "light"
                    ? t("profile.theme.light")
                    : t("settings.theme.system")}
              </button>
            ))}
          </div>
        </Surface>
      )}

      {tab === "integrations" && (
        <div className="space-y-4">
          <McpConnectCard />
        </div>
      )}

      {tab === "alerts" && (
        <>
        {/* Alerts are delivered over Telegram — the link card lives right
            above the toggles it makes meaningful. */}
        <TelegramLinkCard />
        <Surface padding="lg" className="space-y-4">
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
            <label key={key} className="flex min-h-12 items-center justify-between gap-4 rounded-[var(--radius)] bg-muted/50 px-4 transition-colors hover:bg-muted/70">
              <span className="text-sm font-medium">{t(label)}</span>
              <Checkbox
                checked={Boolean(settings[key])}
                onCheckedChange={(checked) =>
                  setSettings((current) => ({ ...current, [key]: checked ? 1 : 0 }))
                }
              />
            </label>
          ))}
          <Button
            size="xl"
            disabled={saving}
            onClick={() => void save({ alerts_enabled: Boolean(settings.alerts_enabled), alert_trades: Boolean(settings.alert_trades), alert_signals: Boolean(settings.alert_signals) })}
          >
            <Save className="h-4 w-4" aria-hidden />
            {saving ? t("settings.saving") : t("settings.alerts.save")}
          </Button>
          {message && (
            <p role="status" className="text-sm text-muted-foreground">
              {message}
            </p>
          )}
        </Surface>
        </>
      )}

      {tab === "skills" && <UserSkillsPanel />}

    </div>
  );

  return embedMode
    ? content
    : (
        <main dir={dir} className="page-shell max-w-6xl space-y-5">
          <PageHeader title={t("settings.title")} description={t("settings.subtitle")} />
          {content}
        </main>
      );
}
