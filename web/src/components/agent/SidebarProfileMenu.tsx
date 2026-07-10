"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronUp,
  LogOut,
  Plug,
  Sliders,
  Languages,
  SunMoon,
  User as UserIcon,
} from "lucide-react";
import { useMe } from "@/hooks/useMe";
import { useLocale } from "@/hooks/useLocale";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

interface MenuItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
  disabled?: boolean;
  hint?: string;
}

/**
 * Profile block pinned to the bottom of the sidebar. Clicking it opens a
 * compact, localized menu (Profile / Trading settings / Language / Theme /
 * Integrations / Logout). The Language row hosts the live Arabic/English
 * switcher; Theme is a placeholder until its tranche lands.
 */
export function SidebarProfileMenu() {
  const router = useRouter();
  const { data } = useMe();
  const { t, dir } = useLocale();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const displayName = data?.displayName ?? "—";
  const email = data?.user?.email ?? "";
  const initial = (displayName || email || "?").trim().charAt(0).toUpperCase();

  async function logout() {
    setOpen(false);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
    router.refresh();
  }

  const items: MenuItem[] = [
    {
      id: "profile",
      label: t("profile.profile"),
      icon: UserIcon,
      onSelect: () => {
        setOpen(false);
        router.push("/dashboard");
      },
    },
    {
      id: "trading-settings",
      label: t("profile.trading_settings"),
      icon: Sliders,
      onSelect: () => {
        setOpen(false);
        router.push("/settings");
      },
    },
    {
      id: "theme",
      label: t("profile.theme"),
      icon: SunMoon,
      onSelect: () => {},
      disabled: true,
      hint: t("profile.coming_soon"),
    },
    {
      id: "integrations",
      label: t("nav.integrations"),
      icon: Plug,
      onSelect: () => {
        setOpen(false);
        router.push("/settings");
      },
    },
    {
      id: "logout",
      label: t("profile.logout"),
      icon: LogOut,
      onSelect: () => void logout(),
    },
  ];

  return (
    <div ref={rootRef} dir={dir} className="relative border-t border-border/60 p-2">
      {open && (
        <div
          role="menu"
          aria-label={t("profile.account_menu")}
          className="absolute bottom-full inset-x-2 mb-2 overflow-hidden rounded-lg border border-border/60 bg-popover shadow-lg"
        >
          {/* Language row: live Arabic/English switcher. */}
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-foreground">
            <Languages className="h-4 w-4 shrink-0" />
            <span className="flex-1">{t("profile.language")}</span>
            <LanguageSwitcher variant="inline" />
          </div>
          <div className="h-px bg-border/60" />
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={item.onSelect}
              className={`flex w-full items-center gap-2 px-3 py-2 text-start text-xs ${
                item.disabled
                  ? "cursor-default text-muted-foreground/60"
                  : item.id === "logout"
                    ? "text-red-500 hover:bg-red-500/10"
                    : "text-foreground hover:bg-muted"
              }`}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-start">{item.label}</span>
              {item.hint && (
                <span className="text-[10px] text-muted-foreground/70">
                  {item.hint}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("profile.account_menu")}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start hover:bg-muted"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
          {initial}
        </span>
        <span className="flex min-w-0 flex-1 flex-col text-start">
          <span className="truncate text-xs font-semibold text-foreground">
            {displayName}
          </span>
          {email && (
            <span className="truncate text-[10px] text-muted-foreground">
              {email}
            </span>
          )}
        </span>
        <ChevronUp
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            open ? "" : "rotate-180"
          }`}
        />
      </button>
    </div>
  );
}
