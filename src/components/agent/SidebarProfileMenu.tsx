"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import {
  ChevronUp,
  Globe,
  LogOut,
  Moon,
  Settings,
  Sun,
  User as UserIcon,
} from "lucide-react";
import { useMe } from "@/hooks/useMe";
import { useLocale } from "@/hooks/useLocale";
import { useTheme } from "@/components/ThemeProvider";
import { useConsoleOverlays } from "@/components/shell/ConsoleOverlays";
import { useSheetSlot } from "@/components/shell/SheetCoordinator";
import { BalanceChip } from "@/components/shell/BalanceChip";
import { useSheetGesture } from "@/hooks/useSheetGesture";
import { APP_LOCALES, type AppLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const LOCALE_LABEL: Record<AppLocale, string> = {
  ar: "العربية",
  en: "English",
};

type MenuPos = { top: number; left: number; width: number; maxHeight: number };

const ITEM_CLASS =
  "flex w-full items-center gap-2 px-3 py-2.5 text-start text-sm text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:bg-muted";

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
      <button
        type="button"
        role="menuitem"
        className={rowClass}
        onClick={() => {
          onDone();
          // Used to push /console/account — a page that has not existed since
          // the migration, so this item 404'd. Settings opens over the
          // workspace (same contract as the settings item below), on the
          // profile tab.
          openSettings("profile");
        }}
      >
        <UserIcon className="h-4 w-4 shrink-0" aria-hidden />
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
          <Globe className="h-4 w-4 shrink-0" aria-hidden />
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
          <Sun className="h-4 w-4 shrink-0" aria-hidden />
        ) : (
          <Moon className="h-4 w-4 shrink-0" aria-hidden />
        )}
        <span>{themeLabel}</span>
      </button>

      <button
        type="button"
        role="menuitem"
        data-testid="profile-settings"
        className={rowClass}
        onClick={() => {
          // Opens over the workspace instead of navigating away from it.
          onDone();
          openSettings();
        }}
      >
        <Settings className="h-4 w-4 shrink-0" aria-hidden />
        {t("nav.settings")}
      </button>

      <div className="h-px bg-border" />

      <button
        type="button"
        role="menuitem"
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2.5 text-start text-sm text-destructive transition-colors duration-150 hover:bg-destructive/10",
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

/** Identity row shared by both surfaces. */
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
    <div className="flex items-center gap-3 border-b border-border px-3 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-sm font-semibold text-foreground">
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
            <ProfileMenuItems
              onDone={() => setOpen(false)}
              langOpen={langOpen}
              setLangOpen={setLangOpen}
            />
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
          {/* Subscription credit — same BalanceChip as the top bar, never MT equity. */}
          <div className="flex justify-center px-4 pb-2">
            <BalanceChip />
          </div>
          <div className="py-1">
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
