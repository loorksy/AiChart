"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { AlertTriangle, X } from "lucide-react";
import SettingsClient, { TABS, type SettingsTabId } from "@/components/SettingsClient";
import { Button } from "@/components/squareui/button";
import { Skeleton } from "@/components/squareui/skeleton";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import type { AdminLimits, EaConnectionMeta, MtAccountMeta, PublicUser, TradingSettings } from "@/lib/types";

/**
 * Hand-written mirror of what /api/console/settings-props returns. The spread
 * below passes the whole parsed body through, so a field missing here still
 * reaches SettingsClient at runtime — but it stops being visible to the
 * compiler, which is how the MetaTrader card would silently vanish from the
 * modal the day someone replaces the spread with a picked list.
 */
type SettingsProps = {
  user: PublicUser;
  settings: TradingSettings;
  limits: AdminLimits;
  ea: EaConnectionMeta | null;
  mt5LinkEnabled?: boolean;
  mt5Account?: MtAccountMeta | null;
  canDownloadEa?: boolean;
};

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * Settings as an overlay instead of a destination.
 *
 * Opening settings used to mean leaving the workspace and then finding your way
 * back to it. Nothing on this surface needs a URL of its own to be useful, so it
 * became a modal — the chart and the conversation stay exactly where they were.
 * /console/settings still exists and still works; this is the path from the
 * account menu, not a replacement for the page.
 *
 * Centre fade+scale on open, deliberately, rather than growing out of the menu
 * item that summoned it: there is already more than one way in (account menu
 * today, a command palette or a deep link tomorrow), and an origin pinned to one
 * of them is wrong from all the others.
 */
export function SettingsModal({
  open,
  onOpenChange,
  initialTab = "profile",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: SettingsTabId;
}) {
  const { t, dir } = useLocale();
  const [tab, setTab] = useState<SettingsTabId>(initialTab);
  const [props, setProps] = useState<SettingsProps | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const tabListRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch("/api/console/settings-props");
      if (!response.ok) throw new Error("failed");
      setProps((await response.json()) as SettingsProps);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetched on first open, not on mount: the modal is rendered by the shell on
  // every console page and most sessions never open it.
  useEffect(() => {
    if (!open || props || loading || error) return;
    void load();
  }, [open, props, loading, error, load]);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  /** Close requests funnel through here so unsaved edits get one question first. */
  const requestClose = useCallback(
    (next: boolean) => {
      if (next) {
        onOpenChange(true);
        return;
      }
      if (dirty) {
        setConfirmingDiscard(true);
        return;
      }
      onOpenChange(false);
    },
    [dirty, onOpenChange],
  );

  const discardAndClose = useCallback(() => {
    setConfirmingDiscard(false);
    setDirty(false);
    // Drop the edited copy so the next open starts from server truth.
    setProps(null);
    onOpenChange(false);
  }, [onOpenChange]);

  /** Roving arrow-key navigation across the section list. */
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
    const index = TABS.findIndex((item) => item.id === tab);
    const next = TABS[(index + step + TABS.length) % TABS.length]!;
    setTab(next.id);
    tabListRef.current
      ?.querySelector<HTMLButtonElement>(`[data-tab-id="${next.id}"]`)
      ?.focus();
  };

  const body = error ? (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <AlertTriangle className="h-6 w-6 text-muted-foreground" aria-hidden />
      <p className="text-sm text-muted-foreground">{t("settings.load_failed")}</p>
      <Button variant="outline" onClick={() => void load()}>
        {t("settings.retry")}
      </Button>
    </div>
  ) : props ? (
    <SettingsClient
      {...props}
      embedMode
      tab={tab}
      onTabChange={setTab}
      onDirtyChange={setDirty}
    />
  ) : (
    <div className="space-y-3 p-1" aria-busy="true">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );

  return (
    <Dialog.Root open={open} onOpenChange={requestClose}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[120] bg-black/60 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none" />
        <Dialog.Popup
          dir={dir}
          data-testid="settings-modal"
          className={cn(
            "fixed inset-0 z-[121] flex flex-col overflow-hidden bg-background text-foreground",
            /*
             * Phone: a full surface. Tablet up: a centred dialog, centred with
             * `inset-0` + `m-auto` rather than a start-edge offset plus a
             * translate — `start-1/2` resolves to `right: 50%` under dir="rtl",
             * which the same negative X translate then pushes the wrong way.
             * Auto margins are symmetric, so one rule centres both directions.
             */
            "sm:m-auto sm:h-[85vh] sm:w-[min(48rem,92vw)] sm:rounded-[var(--radius-lg)] sm:border sm:border-border sm:shadow-2xl",
            "transition-[opacity,transform] duration-200 ease-out",
            "data-starting-style:opacity-0 data-ending-style:opacity-0 sm:data-starting-style:scale-95 sm:data-ending-style:scale-95",
            "motion-reduce:transition-none motion-reduce:sm:data-starting-style:scale-100",
          )}
        >
          <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-3 sm:px-4">
            <Dialog.Title className="text-base font-semibold">
              {t("settings.title")}
            </Dialog.Title>
            <button
              type="button"
              onClick={() => requestClose(false)}
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
            <div
              ref={tabListRef}
              role="tablist"
              aria-label={t("settings.sections")}
              aria-orientation="horizontal"
              onKeyDown={onTabKeyDown}
              className="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-2 sm:w-52 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-e"
            >
              {TABS.map((item) => {
                const Icon = item.icon;
                const active = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    data-tab-id={item.id}
                    aria-selected={active}
                    tabIndex={active ? 0 : -1}
                    onClick={() => setTab(item.id)}
                    className={cn(
                      "flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors duration-150 ease-out sm:min-h-10",
                      FOCUS_RING,
                      active
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="truncate">{t(item.labelKey)}</span>
                  </button>
                );
              })}
            </div>

            <div className="aichart-scroll min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
              {body}
            </div>
          </div>

          {confirmingDiscard && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 p-4">
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
                  <Button variant="destructive" onClick={discardAndClose}>
                    {t("settings.unsaved_discard")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
