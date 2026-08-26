"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import {
  AlertTriangle,
  CalendarClock,
  ChevronUp,
  Globe,
  LogOut,
  Moon,
  LifeBuoy,
  Settings,
  Sun,
  User as UserIcon,
  ShieldCheck,
} from "lucide-react";
import { useMe } from "@/hooks/useMe";
import { useLocale } from "@/hooks/useLocale";
import { useTheme } from "@/components/ThemeProvider";
import { useConsoleOverlays } from "@/components/shell/ConsoleOverlays";
import { useSheetSlot } from "@/components/shell/SheetCoordinator";
import { AccountStatusBadge } from "@/components/billing/AccountStatusBadge";
import { useBillingSummary } from "@/hooks/useBillingSummary";
import { useSupportUnread } from "@/hooks/useSupportUnread";
import Link from "next/link";
import { useSheetGesture } from "@/hooks/useSheetGesture";
import { APP_LOCALES, type AppLocale } from "@/lib/i18n";
import { formatInteger } from "@/lib/display/numericDisplay";
import { formatFullDate } from "@/lib/display/timestamp";
import { cn } from "@/lib/utils";

const LOCALE_LABEL: Record<AppLocale, string> = {
  ar: "العربية",
  en: "English",
};

type MenuPos = { top: number; left: number; width: number; maxHeight: number };

const ITEM_CLASS =
  "flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-start text-sm text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:bg-muted";

/**
 * The account menu's contents, rendered identically by the desktop popover and
 * the mobile sheet. One list, two containers — so the two surfaces cannot drift
 * apart in what they offer or in what order.
 */
function ProfileMenuItems({
  onDone,
  langOpen,
  setLangOpen,
  touchSize = false,
}: {
  onDone: () => void;
  langOpen: boolean;
  setLangOpen: (open: boolean) => void;
  touchSize?: boolean;
}) {
  const router = useRouter();
  const { t, locale, setLocale } = useLocale();
  const { resolved, setTheme } = useTheme();
  const { openSettings } = useConsoleOverlays();
  const { data: me } = useMe();
  // Cosmetic gating only. The console's own data is protected server-side —
  // every /api/admin route re-checks the caller's role AND the specific
  // permission with `requireAdminWith`, so hiding this row is a courtesy to
  // people who are not admins, never the thing that keeps them out.
  const isAdmin = me?.user?.role === "admin";
  // The account menu is where a person looks for "talk to someone", and it is
  // the only entry that is reachable on a phone without opening the nav drawer.
  const supportUnread = useSupportUnread();
  const isDark = resolved === "dark";
  const themeLabel = isDark ? t("shell.theme_to_light") : t("shell.theme_to_dark");
  const rowClass = cn(ITEM_CLASS, touchSize && "min-h-12");

  async function logout() {
    onDone();
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      {isAdmin && (
        // A plain anchor, not next/link: the console is a SEPARATE
        // application served at this path, so the client router must not try
        // to resolve it as a route of this app.
        //
        // It also lives here, in the account menu, and not only in the
        // sidebar: an admin looking for their own admin tools opens their
        // account, and the sidebar entry is invisible on a phone until the
        // drawer is pulled out.
        <a
          href="/admin-app/"
          role="menuitem"
          data-testid="account-admin-console"
          className={rowClass}
          onClick={onDone}
        >
          <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{t("shell.adminConsole")}</span>
        </a>
      )}
      <Link
        href="/console/support"
        role="menuitem"
        data-testid="account-support"
        className={rowClass}
        onClick={onDone}
      >
        <LifeBuoy className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{t("support.title")}</span>
        {supportUnread > 0 && (
          <span
            className="ms-auto inline-flex min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-semibold tabular-nums text-destructive-foreground"
            aria-label={
              supportUnread === 1
                ? t("support.unread_one")
                : t("support.unread_many", { count: String(supportUnread) })
            }
          >
            {supportUnread}
          </span>
        )}
      </Link>
      <button
        type="button"
        role="menuitem"
        className={rowClass}
        onClick={() => {
          onDone();
          // Used to push /console/account — a page that has not existed since
          // the migration, so this item 404'd. Settings is /console/settings/account.
          openSettings("profile");
        }}
      >
        <UserIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        {t("profile.profile")}
      </button>

      <div className="relative">
        <button
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={langOpen}
          aria-label={t("profile.language")}
          title={t("profile.language")}
          data-testid="profile-language"
          className={rowClass}
          onClick={() => setLangOpen(!langOpen)}
        >
          <Globe className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>{t("profile.language")}</span>
          <span className="ms-auto text-[11px] tabular-nums text-muted-foreground">
            {LOCALE_LABEL[locale]}
          </span>
        </button>
        {langOpen && (
          <div
            role="menu"
            className="mx-2 mb-1 overflow-hidden rounded-md border border-border bg-background"
            style={{ backgroundColor: "var(--background)" }}
          >
            {APP_LOCALES.map((lng) => (
              <button
                key={lng}
                type="button"
                role="menuitemradio"
                aria-checked={lng === locale}
                className={cn(
                  "flex w-full px-3 py-2 text-start text-xs transition-colors duration-150 hover:bg-muted",
                  touchSize && "min-h-11 items-center",
                  lng === locale
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground",
                )}
                onClick={() => {
                  setLocale(lng);
                  setLangOpen(false);
                }}
              >
                {LOCALE_LABEL[lng]}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        role="menuitem"
        data-testid="theme-toggle"
        aria-label={themeLabel}
        title={themeLabel}
        className={rowClass}
        onClick={() => setTheme(isDark ? "light" : "dark")}
      >
        {isDark ? (
          <Sun className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <Moon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span>{themeLabel}</span>
      </button>

      <button
        type="button"
        role="menuitem"
        data-testid="profile-settings"
        className={rowClass}
        onClick={() => {
          onDone();
          openSettings();
        }}
      >
        <Settings className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        {t("nav.settings")}
      </button>

      {/* The one destructive action stands apart from navigation. */}
      <div className="mx-1 my-1.5 h-px bg-border/70" aria-hidden />

      <button
        type="button"
        role="menuitem"
        className={cn(
          "flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-start text-sm text-destructive transition-colors duration-150 hover:bg-destructive/10 focus-visible:outline-none focus-visible:bg-destructive/10",
          touchSize && "min-h-12",
        )}
        onClick={() => void logout()}
      >
        <LogOut className="h-4 w-4 shrink-0" aria-hidden />
        {t("profile.logout")}
      </button>
    </>
  );
}

/** Identity row shared by both surfaces: who is signed in, nothing else. */
function ProfileIdentity({
  initial,
  displayName,
  email,
}: {
  initial: string;
  displayName: string;
  email: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-gradient-to-b from-muted to-muted/40 text-base font-semibold text-foreground">
        {initial}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold text-foreground">{displayName}</span>
        {email ? (
          <span className="truncate text-xs text-muted-foreground">{email}</span>
        ) : null}
      </span>
    </div>
  );
}

function useIdentity(displayNameProp?: string) {
  const { data } = useMe();
  const displayName = displayNameProp ?? data?.displayName ?? "—";
  const email = data?.user?.email ?? "";
  const initial = (displayName || email || "?").trim().charAt(0).toUpperCase();
  return { displayName, email, initial };
}

/**
 * Account control for the sidebar footer.
 *
 * On the desktop rail this stays a portal popover anchored to the trigger. In
 * the mobile drawer the trigger instead hands off to the account sheet the shell
 * owns — a popover positioned off `getBoundingClientRect` inside a drawer that
 * is itself an overlay lands wherever the arithmetic says, which on a phone is
 * rarely where the thumb expects.
 */
export function SidebarProfileMenu({
  collapsed = false,
  displayName: displayNameProp,
  variant = "rail",
}: {
  collapsed?: boolean;
  displayName?: string;
  /**
   * `rail` = sidebar footer. `drawer` = inside the mobile nav drawer.
   * `topbar` = the avatar in the console header, which is now the primary way
   * in: reaching your account should not mean opening navigation first.
   */
  variant?: "rail" | "drawer" | "topbar";
}) {
  const { t, dir } = useLocale();
  const [open, setOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const [mounted, setMounted] = useState(false);
  const [, setSheetOpen] = useSheetSlot("profileMenu");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const { displayName, email, initial } = useIdentity(displayNameProp);
  const isTopBar = variant === "topbar";
  // Both hand off to the shell-owned sheet on touch-sized viewports.
  const [isCompact, setIsCompact] = useState(false);
  const usesSheet = variant === "drawer" || (isTopBar && isCompact);
  const isDrawer = usesSheet;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!isTopBar) return;
    const query = window.matchMedia("(max-width: 1023px)");
    const sync = () => setIsCompact(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [isTopBar]);

  useLayoutEffect(() => {
    if (isDrawer || !open || !triggerRef.current) {
      setPos(null);
      return;
    }
    const place = () => {
      const rect = triggerRef.current!.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 220), 280);
      const gutter = 8;
      let left = dir === "rtl" ? rect.right - width : rect.left;
      left = Math.max(gutter, Math.min(left, window.innerWidth - width - gutter));
      const estimatedHeight = 320;
      const spaceAbove = rect.top - gutter;
      const spaceBelow = window.innerHeight - rect.bottom - gutter;
      const placeAbove = spaceAbove >= estimatedHeight || spaceAbove >= spaceBelow;
      const maxHeight = Math.max(160, placeAbove ? spaceAbove : spaceBelow);
      const top = placeAbove
        ? Math.max(gutter, rect.top - Math.min(estimatedHeight, maxHeight) - 6)
        : rect.bottom + 6;
      setPos({ top, left, width, maxHeight });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, dir, langOpen, isDrawer]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const node = e.target as Node;
      if (triggerRef.current?.contains(node)) return;
      if (menuRef.current?.contains(node)) return;
      setOpen(false);
      setLangOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (langOpen) setLangOpen(false);
      else {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, langOpen]);

  const menu =
    !isDrawer && mounted && open && pos
      ? createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={t("profile.account_menu")}
            data-testid="sidebar-profile-popover"
            dir={dir}
            className="fixed z-[200] overflow-y-auto rounded-lg border border-border bg-background text-foreground opacity-100 shadow-lg"
            style={{
              top: pos.top,
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
              backgroundColor: "var(--background)",
            }}
          >
            <div className="p-1.5">
              <ProfileMenuItems
                onDone={() => setOpen(false)}
                langOpen={langOpen}
                setLangOpen={setLangOpen}
              />
            </div>
          </div>,
          document.body,
        )
      : null;

  if (isTopBar) {
    return (
      <>
        {menu}
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup={usesSheet ? "dialog" : "menu"}
          aria-expanded={usesSheet ? undefined : open}
          aria-label={t("profile.account_menu")}
          data-testid="topbar-profile"
          onClick={() => {
            if (usesSheet) {
              setSheetOpen(true);
              return;
            }
            setOpen((v) => !v);
            setLangOpen(false);
          }}
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-sm font-semibold text-foreground transition-colors duration-150 hover:bg-muted/70",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
        >
          {initial}
        </button>
      </>
    );
  }

  return (
    <div
      dir={dir}
      data-testid="sidebar-profile-menu"
      className="relative border-t border-sidebar-border p-2"
    >
      {menu}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup={isDrawer ? "dialog" : "menu"}
        aria-expanded={isDrawer ? undefined : open}
        aria-controls={isDrawer ? undefined : menuId}
        aria-label={t("profile.account_menu")}
        onClick={() => {
          if (isDrawer) {
            // Taking the overlay slot closes the drawer this button lives in:
            // navigation hands off to account, one surface at a time.
            setSheetOpen(true);
            return;
          }
          setOpen((v) => !v);
          setLangOpen(false);
        }}
        className={cn(
          "flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-2 text-start transition-colors duration-150 hover:bg-muted",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar",
          collapsed && "justify-center px-0",
        )}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-sm font-semibold text-foreground">
          {initial}
        </span>
        {!collapsed && (
          <>
            <span className="flex min-w-0 flex-1 flex-col text-start">
              <span className="truncate text-xs font-semibold text-foreground">
                {displayName}
              </span>
              {email ? (
                <span className="truncate text-[10px] text-muted-foreground">{email}</span>
              ) : null}
            </span>
            <ChevronUp
              aria-hidden
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                open ? "" : "rotate-180",
              )}
            />
          </>
        )}
      </button>
    </div>
  );
}

/**
 * The account menu as a bottom sheet, mounted once by the shell so it outlives
 * the navigation drawer that opens it.
 */
export function ProfileAccountSheet({ displayName }: { displayName?: string }) {
  const { t, dir } = useLocale();
  const [open, setOpen] = useSheetSlot("profileMenu");
  const [langOpen, setLangOpen] = useState(false);
  const { displayName: name, email, initial } = useIdentity(displayName);
  const sheetRef = useRef<HTMLDivElement>(null);
  // Menu content is short; expanding it to full screen would expand a void.
  const { handleProps } = useSheetGesture({
    sheetRef,
    onDismiss: () => setOpen(false),
  });

  useEffect(() => {
    if (!open) setLangOpen(false);
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[130] bg-black/60 transition-opacity duration-250 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none" />
        <Dialog.Popup
          ref={sheetRef}
          dir={dir}
          data-testid="profile-account-sheet"
          className={cn(
            "fixed inset-x-0 bottom-0 z-[131] max-h-[85vh] overflow-y-auto rounded-t-[var(--radius-lg)] border-t border-border bg-background pb-[max(.5rem,env(safe-area-inset-bottom))] text-foreground shadow-2xl",
            "transition-transform duration-300 ease-out data-ending-style:translate-y-full data-starting-style:translate-y-full",
            "motion-reduce:transition-none",
          )}
        >
          <Dialog.Title className="sr-only">{t("profile.account_menu")}</Dialog.Title>
          <div
            {...handleProps}
            data-testid="profile-sheet-handle"
            className="flex cursor-grab justify-center py-2 active:cursor-grabbing"
          >
            <span aria-hidden className="h-1 w-10 rounded-full bg-muted-foreground/40" />
          </div>
          <ProfileIdentity initial={initial} displayName={name} email={email} />
          {/* The account panel: status, balance, expiry, the alerts and both
              actions — everything visible at once, contained in ONE card. */}
          <AccountFacts />
          <div className="px-2 pb-1 pt-2">
            <ProfileMenuItems
              onDone={() => setOpen(false)}
              langOpen={langOpen}
              setLangOpen={setLangOpen}
              touchSize
            />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The plan-and-balance card (billing v3), in one contained frame with a real
 * hierarchy: the plan chip and the renewal date share the top axis, the
 * credit balance is the card's hero number (in the reader's own digits), the
 * threshold alerts render as styled banners INSIDE the card, and the two
 * actions are buttons rather than floating text links.
 */
function AccountFacts() {
  const { t, locale } = useLocale();
  const { summary } = useBillingSummary();
  if (!summary) return null;
  const pro = summary.status === "pro";
  // Exhausted and low are distinct, mutually exclusive states: an account at
  // zero is told its balance HAS run out (and what stopped), never that it
  // is "running low".
  const balanceAlert = summary.alerts.exhausted || summary.alerts.low_balance;
  return (
    <div
      data-testid="account-facts"
      className="mx-4 mt-2 rounded-[var(--radius-lg)] border border-border/70 bg-muted/20 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <AccountStatusBadge />
        {pro ? (
          <span className="text-[11px] text-muted-foreground">
            {summary.expires_at
              ? t("account.expires_on", {
                  date: formatFullDate(Date.parse(summary.expires_at), locale),
                })
              : t("billing.status_active")}
          </span>
        ) : null}
      </div>

      <p className="mt-4 text-[11px] font-medium text-muted-foreground">
        {t("account.balance_label")}
      </p>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span
          data-testid="account-balance"
          className="text-3xl font-semibold leading-none tracking-tight tabular-nums text-foreground"
        >
          {formatInteger(summary.balance, locale)}
        </span>
        <span className="text-xs font-medium text-muted-foreground">
          {t("account.credits_unit")}
        </span>
      </div>

      {balanceAlert && (
        <div
          role="status"
          data-testid="account-alert"
          className={cn(
            "mt-3 flex items-start gap-2 rounded-[var(--radius)] border px-3 py-2 text-xs leading-5",
            summary.alerts.exhausted
              ? "border-destructive/25 bg-destructive/10 text-destructive"
              : "border-warning/25 bg-warning/10 text-warning",
          )}
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {summary.alerts.exhausted
              ? t("account.alert.exhausted")
              : t("account.alert.low_balance")}
          </span>
        </div>
      )}
      {summary.alerts.expiring_soon && (
        <div
          role="status"
          data-testid="account-alert"
          className="mt-3 flex items-start gap-2 rounded-[var(--radius)] border border-warning/25 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning"
        >
          <CalendarClock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{t("account.alert.expiring_soon")}</span>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <Link
          href={pro ? "/console/billing" : "/subscribe"}
          data-testid="account-cta"
          className="inline-flex min-h-9 flex-1 items-center justify-center rounded-full bg-foreground px-3 text-center text-xs font-semibold text-background transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {pro ? t("billing.cta.topup") : t("billing.cta.subscribe")}
        </Link>
        <Link
          href="/console/billing"
          data-testid="account-ledger"
          className="metal-chip min-h-9 flex-1 justify-center text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("account.ledger_link")}
        </Link>
      </div>
    </div>
  );
}

