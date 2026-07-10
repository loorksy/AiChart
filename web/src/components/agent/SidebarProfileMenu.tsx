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
 * compact menu (Profile / Trading settings / Language / Theme / Integrations /
 * Logout). Language + Theme are placeholders here — the i18n/theme systems land
 * in a later tranche — so they are shown but disabled with a "coming soon" hint.
 */
export function SidebarProfileMenu() {
  const router = useRouter();
  const { data } = useMe();
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

  const displayName = data?.displayName ?? "المستخدم";
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
      label: "الملف الشخصي",
      icon: UserIcon,
      onSelect: () => {
        setOpen(false);
        router.push("/dashboard");
      },
    },
    {
      id: "trading-settings",
      label: "إعدادات التداول",
      icon: Sliders,
      onSelect: () => {
        setOpen(false);
        router.push("/settings");
      },
    },
    {
      id: "language",
      label: "اللغة",
      icon: Languages,
      onSelect: () => {},
      disabled: true,
      hint: "قريباً",
    },
    {
      id: "theme",
      label: "المظهر",
      icon: SunMoon,
      onSelect: () => {},
      disabled: true,
      hint: "قريباً",
    },
    {
      id: "integrations",
      label: "التكاملات",
      icon: Plug,
      onSelect: () => {
        setOpen(false);
        router.push("/settings");
      },
    },
    {
      id: "logout",
      label: "تسجيل الخروج",
      icon: LogOut,
      onSelect: () => void logout(),
    },
  ];

  return (
    <div ref={rootRef} className="relative border-t border-border/60 p-2">
      {open && (
        <div
          role="menu"
          aria-label="قائمة الحساب"
          className="absolute bottom-full left-2 right-2 mb-2 overflow-hidden rounded-lg border border-border/60 bg-popover shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={item.onSelect}
              className={`flex w-full items-center gap-2 px-3 py-2 text-right text-xs ${
                item.disabled
                  ? "cursor-default text-muted-foreground/60"
                  : item.id === "logout"
                    ? "text-red-500 hover:bg-red-500/10"
                    : "text-foreground hover:bg-muted"
              }`}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{item.label}</span>
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
        aria-label="حساب المستخدم"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-right hover:bg-muted"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
          {initial}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
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
