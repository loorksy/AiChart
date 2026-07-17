"use client";

import { useEffect, useId, useRef, useState } from "react";
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

/**
 * Compact profile control for the canonical sidebar footer.
 * Popover order: Profile → Language → Theme → Settings → Logout.
 * Language and Theme are icon-first with localized tooltip / aria-label.
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
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setLangOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (langOpen) setLangOpen(false);
        else setOpen(false);
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

  return (
    <div
      ref={rootRef}
      dir={dir}
      data-testid="sidebar-profile-menu"
      className="relative border-t border-sidebar-border p-2"
    >
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={t("profile.account_menu")}
          className="absolute bottom-full inset-x-2 z-40 mb-2 overflow-hidden rounded-lg border border-border bg-popover shadow-md"
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
              >
                {APP_LOCALES.map((lng) => (
                  <button
                    key={lng}
                    type="button"
                    role="menuitemradio"
                    aria-checked={lng === locale}
                    className={cn(
                      "flex w-full px-3 py-2 text-start text-xs hover:bg-muted",
                      lng === locale ? "font-semibold text-foreground" : "text-muted-foreground",
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
        </div>
      )}

      <button
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
