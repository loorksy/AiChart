"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
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
import { APP_LOCALES, type AppLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const LOCALE_LABEL: Record<AppLocale, string> = {
  ar: "العربية",
  en: "English",
};

type MenuPos = { top: number; left: number; width: number; maxHeight: number };

/**
 * Compact profile control for the canonical sidebar footer.
 * Popover renders via portal on an opaque elevated surface above conversations.
 */
export function SidebarProfileMenu({
  collapsed = false,
  displayName: displayNameProp,
}: {
  collapsed?: boolean;
  displayName?: string;
}) {
  const router = useRouter();
  const { data } = useMe();
  const { t, dir, locale, setLocale } = useLocale();
  const { resolved, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setPos(null);
      return;
    }
    const place = () => {
      const rect = triggerRef.current!.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 220), 280);
      const gutter = 8;
      let left = dir === "rtl" ? rect.right - width : rect.left;
      left = Math.max(gutter, Math.min(left, window.innerWidth - width - gutter));
      const estimatedHeight = 280;
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
  }, [open, dir, langOpen]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
      setLangOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (langOpen) setLangOpen(false);
        else {
          setOpen(false);
          triggerRef.current?.focus();
        }
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, langOpen]);

  const displayName = displayNameProp ?? data?.displayName ?? "—";
  const email = data?.user?.email ?? "";
  const initial = (displayName || email || "?").trim().charAt(0).toUpperCase();
  const isDark = resolved === "dark";
  const themeLabel = isDark ? t("shell.theme_to_light") : t("shell.theme_to_dark");

  async function logout() {
    setOpen(false);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
    router.refresh();
  }

  const menu =
    mounted && open && pos
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
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-sm text-foreground hover:bg-muted"
              onClick={() => {
                setOpen(false);
                router.push("/console/account");
              }}
            >
              <UserIcon className="h-4 w-4 shrink-0" />
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
                className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-sm text-foreground hover:bg-muted"
                onClick={() => setLangOpen((v) => !v)}
              >
                <Globe className="h-4 w-4 shrink-0" aria-hidden />
                <span className="sr-only">{t("profile.language")}</span>
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
                        "flex w-full px-3 py-2 text-start text-xs hover:bg-muted",
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
              className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-sm text-foreground hover:bg-muted"
              onClick={() => setTheme(isDark ? "light" : "dark")}
            >
              {isDark ? (
                <Sun className="h-4 w-4 shrink-0" aria-hidden />
              ) : (
                <Moon className="h-4 w-4 shrink-0" aria-hidden />
              )}
              <span className="sr-only">{themeLabel}</span>
            </button>

            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-sm text-foreground hover:bg-muted"
              onClick={() => {
                setOpen(false);
                router.push("/console/settings");
              }}
            >
              <Settings className="h-4 w-4 shrink-0" />
              {t("nav.settings")}
            </button>

            <div className="h-px bg-border" />

            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-sm text-destructive hover:bg-destructive/10"
              onClick={() => void logout()}
            >
              <LogOut className="h-4 w-4 shrink-0" />
              {t("profile.logout")}
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <div dir={dir} data-testid="sidebar-profile-menu" className="relative border-t border-sidebar-border p-2">
      {menu}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t("profile.account_menu")}
        onClick={() => {
          setOpen((v) => !v);
          setLangOpen(false);
        }}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start hover:bg-muted",
          collapsed && "justify-center px-0",
        )}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-sm font-semibold text-foreground">
          {initial}
        </span>
        {!collapsed && (
          <>
            <span className="flex min-w-0 flex-1 flex-col text-start">
              <span className="truncate text-xs font-semibold text-foreground">{displayName}</span>
              {email ? (
                <span className="truncate text-[10px] text-muted-foreground">{email}</span>
              ) : null}
            </span>
            <ChevronUp
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                open ? "" : "rotate-180",
              )}
            />
          </>
        )}
      </button>
    </div>
  );
}
