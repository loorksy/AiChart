"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, Cable, Moon, Save, Sparkles, Sun, User, X } from "lucide-react";
import { McpConnectCard } from "@/components/settings/McpConnectCard";
import { TelegramLinkCard } from "@/components/settings/TelegramLinkCard";
import { BrokerLinkCard } from "@/components/settings/BrokerLinkCard";
import { UserSkillsPanel } from "@/components/settings/UserSkillsPanel";
import { AgentMemoryPanel } from "@/components/settings/AgentMemoryPanel";

import { Surface } from "@/components/foundation";
import { Button, buttonVariants } from "@/components/squareui/button";
import { Checkbox } from "@/components/squareui/checkbox";
import { useTheme, type ThemePreference } from "@/components/ThemeProvider";
import { useLocale } from "@/hooks/useLocale";
import {
  SETTINGS_SECTIONS,
  settingsPath,
  settingsTabFromPathname,
  type SettingsSectionId,
} from "@/lib/settings/paths";
import { cn } from "@/lib/utils";
import type { AdminLimits, PublicUser, TradingSettings } from "@/lib/types";

type TabId = SettingsSectionId | "subscription";

/**
 * Ordered by how often a trader actually opens each one, not by how the ids
 * happened to be declared. Risk per Trade is not here: it sizes the next
 * position, so it belongs in the composer beside the send button, not two
 * navigations away.
 */
const TAB_ICONS = {
  profile: User,
  alerts: Bell,
  appearance: Sun,
  integrations: Cable,
  skills: Sparkles,
} as const;

export const TABS = SETTINGS_SECTIONS.map((section) => ({
  id: section.id,
  slug: section.slug,
  labelKey: section.labelKey,
  icon: TAB_ICONS[section.id],
}));

export type SettingsTabId = TabId;

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const OVERLAY_PANEL =
  "fixed inset-0 z-[121] flex flex-col overflow-hidden bg-background text-foreground sm:m-auto sm:h-[85vh] sm:w-[min(48rem,92vw)] sm:rounded-[var(--radius-lg)] sm:border sm:border-border sm:shadow-2xl";

export default function SettingsClient({
  user,
  settings: initialSettings,
  limits: _limits,
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
  initialTab?: TabId;
  embedMode?: boolean;
  visibleTabs?: TabId[];
  /** Controlled tab. When set, the host owns navigation and the pill row hides. */
  tab?: TabId;
  onTabChange?: (tab: TabId) => void;
  /** Fires when local edits diverge from (or return to) what the server holds. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const tabs = visibleTabs ? TABS.filter((item) => visibleTabs.includes(item.id)) : TABS;
  const pathTab = settingsTabFromPathname(pathname) ?? "profile";
  const [uncontrolledTab, setTab] = useState<TabId>(
    initialTab && tabs.some((item) => item.id === initialTab) ? initialTab : tabs[0]?.id ?? "profile",
  );
  const tab = embedMode ? (controlledTab ?? uncontrolledTab) : pathTab;
  const [settings, setSettings] = useState(initialSettings);
  const [saved, setSaved] = useState(initialSettings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const tabListRef = useRef<HTMLElement | null>(null);
  const { theme, setTheme } = useTheme();
  const { t, dir } = useLocale();
  void _limits;

  /**
   * Edits live here until their section's Save button lands them, so switching
   * tabs must not be what discards them. Reporting dirtiness upward lets a host
   * refuse to leave on top of unsaved input.
   */
  const dirty =
    Boolean(settings.alerts_enabled) !== Boolean(saved.alerts_enabled) ||
    Boolean(settings.alert_trades) !== Boolean(saved.alert_trades) ||
    Boolean(settings.alert_signals) !== Boolean(saved.alert_signals);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const leave = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/chat");
  }, [router]);

  const requestClose = useCallback(() => {
    if (dirty) {
      setConfirmingDiscard(true);
      return;
    }
    leave();
  }, [dirty, leave]);

  useEffect(() => {
    if (embedMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [embedMode, requestClose]);

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

  const onTabKeyDown = (event: React.KeyboardEvent) => {
    const forward = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const back = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
    const step =
      event.key === "ArrowDown" || event.key === forward
        ? 1
        : event.key === "ArrowUp" || event.key === back
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const index = tabs.findIndex((item) => item.id === tab);
    const next = tabs[(index + step + tabs.length) % tabs.length]!;
    if (embedMode) {
      setTab(next.id);
      onTabChange?.(next.id);
    } else {
      router.push(settingsPath(next.id));
    }
    tabListRef.current
      ?.querySelector<HTMLElement>(`[data-tab-id="${next.id}"]`)
      ?.focus();
  };

  const panels = (
    <>
      {tab === "profile" && (
        <Surface padding="lg" className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">{t("settings.tab.account")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("settings.account.description")}
            </p>
          </div>
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
            href={settingsPath("profile")}
            className={cn(buttonVariants({ variant: "outline", size: "xl" }))}
          >
            {t("settings.manage_account")}
          </Link>
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
          <BrokerLinkCard />
          <McpConnectCard />
        </div>
      )}

      {tab === "alerts" && (
        <>
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
    </>
  );

  const sectionClass = (active: boolean) =>
    cn(
      "flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors duration-150 ease-out sm:min-h-10",
      FOCUS_RING,
      active
        ? "bg-muted text-foreground"
        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
    );

  if (embedMode) {
    return (
      <div className="space-y-4" dir={dir}>
        {controlledTab === undefined && tabs.length > 1 && (
          <nav
            ref={tabListRef}
            className="flex gap-1.5 overflow-x-auto pb-1"
            aria-label={t("settings.sections")}
            onKeyDown={onTabKeyDown}
          >
            {tabs.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-tab-id={item.id}
                  onClick={() => {
                    setTab(item.id);
                    onTabChange?.(item.id);
                  }}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium transition-colors focus-ring sm:min-h-9",
                    active
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
        {panels}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[120] cursor-default bg-black/60"
        aria-label={t("shell.close")}
        onClick={requestClose}
      />
      <div dir={dir} data-testid="settings-modal" className={OVERLAY_PANEL}>
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-3 sm:px-4">
          <h1 className="text-base font-semibold">{t("settings.title")}</h1>
          <button
            type="button"
            onClick={requestClose}
            aria-label={t("shell.close")}
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground sm:size-9",
              FOCUS_RING,
            )}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav
            ref={tabListRef}
            aria-label={t("settings.sections")}
            onKeyDown={onTabKeyDown}
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-2 sm:w-52 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-e"
          >
            {TABS.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <Link
                  key={item.id}
                  href={settingsPath(item.id)}
                  data-tab-id={item.id}
                  aria-current={active ? "page" : undefined}
                  className={sectionClass(active)}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="truncate">{t(item.labelKey)}</span>
                </Link>
              );
            })}
          </nav>

          <div className="aichart-scroll min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
            {panels}
          </div>
        </div>

        {confirmingDiscard && (
          <div className="fixed inset-0 z-[122] flex items-center justify-center bg-black/50 p-4">
            <div
              role="alertdialog"
              aria-modal="true"
              aria-label={t("settings.unsaved_title")}
              className="w-full max-w-sm rounded-[var(--radius-lg)] border border-border bg-background p-4 shadow-xl"
            >
              <p className="text-sm font-semibold">{t("settings.unsaved_title")}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("settings.unsaved_body")}
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setConfirmingDiscard(false)}>
                  {t("settings.unsaved_keep")}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setConfirmingDiscard(false);
                    leave();
                  }}
                >
                  {t("settings.unsaved_discard")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
