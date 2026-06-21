"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Bot,
  ChevronDown,
  LayoutDashboard,
  LineChart,
  LogOut,
  MessageSquare,
  MessageSquarePlus,
  PanelRightClose,
  Radar,
  Settings,
  Shield,
  Sparkles,
  Trash2,
  TrendingUp,
  User,
  Globe,
  Sun,
  Moon,
} from "lucide-react";
import { useChatStore } from "@/stores/chat-store";
import { cn } from "@/lib/utils";
import { useLocale } from "@/components/LocaleProvider";
import { useTheme } from "@/components/ThemeProvider";

const MAIN_TABS = [
  { href: "/chat", icon: MessageSquare },
  { href: "/dashboard", icon: LayoutDashboard },
  { href: "/command", icon: Radar },
  { href: "/agent", icon: Bot },
  { href: "/market", icon: LineChart },
  { href: "/signals/new", icon: TrendingUp },
] as const;

function isTabActive(pathname: string, href: string): boolean {
  if (href === "/signals/new") return pathname.startsWith("/signals");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MobileDrawer({
  open,
  onClose,
  email,
  displayName,
  role,
  creditsRemaining,
  creditsLimit,
  creditsLoading,
  onNewChat,
  onLogout,
}: {
  open: boolean;
  onClose: () => void;
  email: string;
  displayName: string;
  role: "user" | "admin";
  creditsRemaining: number;
  creditsLimit: number;
  creditsLoading?: boolean;
  onNewChat?: () => void;
  onLogout?: () => void;
}) {
  const pathname = usePathname();
  const onChatPage = pathname.startsWith("/chat");
  const { t, locale, setLocale } = useLocale();
  const { setTheme, resolved: resolvedTheme } = useTheme();
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  const {
    conversations,
    selectedId,
    selectConversation,
    deleteConversation,
    resetSelection,
    createNew,
  } = useChatStore();

  const getTabLabel = (href: string) => {
    switch (href) {
      case "/chat":
        return t("sidebar.chat");
      case "/dashboard":
        return t("sidebar.dashboard");
      case "/command":
        return t("sidebar.command");
      case "/agent":
        return t("sidebar.agent");
      case "/market":
        return t("sidebar.market");
      case "/signals/new":
        return t("sidebar.signals");
      default:
        return "";
    }
  };

  async function handleNewChat() {
    resetSelection();
    await createNew();
    onNewChat?.();
    onClose();
  }

  async function handleSelect(id: number) {
    await selectConversation(id);
    onClose();
  }

  const initials = displayName.slice(0, 2).toUpperCase();

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(e.target as Node)
      ) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 md:hidden",
        !open && "pointer-events-none",
      )}
      aria-hidden={!open}
    >
      <button
        type="button"
        className={cn(
          "absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ease-out motion-reduce:transition-none",
          open ? "opacity-100" : "opacity-0",
        )}
        aria-label={t("chat.close_chart")}
        onClick={onClose}
        tabIndex={open ? 0 : -1}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="القائمة الجانبية"
        className={cn(
          "absolute inset-y-0 start-0 flex w-[min(100%,17.5rem)] flex-col overscroll-contain border-e border-sidebar-border bg-sidebar text-sidebar-foreground shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none",
          open ? "translate-x-0" : "ltr:-translate-x-full rtl:translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-3 pt-3">
          <Link
            href="/chat"
            onClick={onClose}
            className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 transition hover:bg-sidebar-accent"
          >
            <img src="/logo.png" alt="AiChart" className="h-5 w-5 shrink-0 object-contain rounded-md" />
            <span className="truncate text-sm font-bold tracking-tight">AiChart</span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-muted-foreground transition hover:bg-sidebar-accent hover:text-foreground"
            aria-label="إغلاق القائمة"
            title="طي"
          >
            <PanelRightClose className="h-5 w-5" />
          </button>
        </div>

        <div className="px-2 pb-2">
          <button
            type="button"
            onClick={() => void handleNewChat()}
            className="flex h-11 min-h-[44px] w-full items-center gap-2 rounded-lg border border-sidebar-border px-3 text-sm font-medium transition hover:bg-sidebar-accent text-right"
          >
            <MessageSquarePlus className="h-4 w-4 shrink-0 text-primary" />
            <span>{t("sidebar.new_chat")}</span>
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2">
          {MAIN_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = isTabActive(pathname, tab.href);
            const label = getTabLabel(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                onClick={onClose}
                data-active={active}
                className={cn(
                  "sidebar-nav-item flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                  active
                    ? "bg-sidebar-accent text-foreground font-semibold"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                )}
              >
                <Icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                <span>{label}</span>
              </Link>
            );
          })}

          <p className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
            {t("sidebar.recent_chats")}
          </p>
          {conversations.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground/60 italic">{t("sidebar.no_chats")}</p>
          ) : (
            conversations.map((c) => {
              const active = selectedId === c.id && onChatPage;
              return (
                <div key={c.id} className="group flex items-center rounded-lg hover:bg-sidebar-accent/50 transition">
                  <Link
                    href="/chat"
                    onClick={() => void handleSelect(c.id)}
                    data-active={active}
                    className={cn(
                      "sidebar-conv-item min-w-0 flex-1 truncate text-xs px-3 py-2 text-right transition font-medium",
                      active ? "text-foreground font-semibold" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {c.title}
                  </Link>
                  <button
                    type="button"
                    onClick={() => void deleteConversation(c.id)}
                    className="me-2 shrink-0 rounded-md p-1.5 text-muted-foreground/60 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    title={t("sidebar.delete")}
                    aria-label={t("sidebar.delete")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </nav>

        {/* User Card trigger on mobile footer */}
        <div className="relative border-t border-sidebar-border p-2" ref={profileMenuRef}>
          {/* Profile Menu Popover */}
          {profileMenuOpen && (
            <div className="absolute bottom-full start-0 z-50 mb-2 w-[calc(100%-1rem)] mx-2 overflow-hidden rounded-xl border border-border bg-popover p-2.5 shadow-xl animate-in slide-in-from-bottom-2 duration-150">
              <div className="space-y-1 pb-2 border-b border-border/60">
                <Link
                  href="/settings"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    onClose();
                  }}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-foreground transition hover:bg-secondary"
                >
                  <Settings className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{t("profile.settings")}</span>
                </Link>
                <Link
                  href="/dashboard"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    onClose();
                  }}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-foreground transition hover:bg-secondary"
                >
                  <LayoutDashboard className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{t("profile.analytics")}</span>
                </Link>
                <Link
                  href="/settings#account"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    onClose();
                  }}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-foreground transition hover:bg-secondary"
                >
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{t("profile.account")}</span>
                </Link>
                {role === "admin" && (
                  <Link
                    href="/console"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      onClose();
                    }}
                    className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/10"
                  >
                    <Shield className="h-3.5 w-3.5 text-primary" />
                    <span>{t("sidebar.admin")}</span>
                  </Link>
                )}
              </div>

              {/* Theme Selector (Segmented) */}
              <div className="py-2 border-b border-border/60">
                <p className="px-2 text-[10px] font-semibold text-muted-foreground uppercase mb-1">
                  {t("profile.theme")}
                </p>
                <div className="flex rounded-lg bg-muted p-0.5 border border-border/40">
                  <button
                    type="button"
                    onClick={() => setTheme("dark")}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1 rounded-md py-1 text-center text-xs font-semibold transition-all",
                      resolvedTheme === "dark"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Moon className="h-3 w-3" />
                    {t("profile.theme.dark")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTheme("light")}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1 rounded-md py-1 text-center text-xs font-semibold transition-all",
                      resolvedTheme === "light"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Sun className="h-3 w-3" />
                    {t("profile.theme.light")}
                  </button>
                </div>
              </div>

              {/* Language Selector (Segmented) */}
              <div className="py-2 border-b border-border/60">
                <p className="px-2 text-[10px] font-semibold text-muted-foreground uppercase mb-1">
                  {t("profile.language")}
                </p>
                <div className="flex rounded-lg bg-muted p-0.5 border border-border/40">
                  <button
                    type="button"
                    onClick={() => setLocale("ar")}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1 rounded-md py-1 text-center text-xs font-semibold transition-all",
                      locale === "ar"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Globe className="h-3 w-3" />
                    {t("profile.language.ar")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocale("en")}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1 rounded-md py-1 text-center text-xs font-semibold transition-all",
                      locale === "en"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Globe className="h-3 w-3" />
                  {t("profile.language.en")}
                </button>
              </div>
            </div>

            {/* Logout button */}
            {onLogout && (
              <button
                type="button"
                onClick={() => {
                  setProfileMenuOpen(false);
                  onLogout();
                }}
                className="mt-1.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10 transition"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>{t("profile.logout")}</span>
              </button>
            )}
          </div>
        )}

          <Link
            href="/dashboard"
            onClick={onClose}
            className="mb-2 block rounded-lg px-3 py-1.5 transition hover:bg-sidebar-accent border border-sidebar-border bg-card/30"
          >
            <p className="text-[10px] text-muted-foreground leading-none mb-0.5">{t("sidebar.credits")}</p>
            <p className="text-xs font-semibold leading-none">
              {creditsLoading ? "…" : creditsRemaining}
              <span className="ms-1 text-[10px] font-normal text-muted-foreground">
                / {creditsLimit}
              </span>
            </p>
          </Link>

          <div
            onClick={() => setProfileMenuOpen((o) => !o)}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-lg p-1.5 transition hover:bg-sidebar-accent",
              profileMenuOpen && "bg-sidebar-accent",
            )}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary border border-border text-xs font-bold text-foreground">
              {initials}
            </div>
            <div className="min-w-0 flex-1 flex items-center justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight text-foreground">{displayName}</p>
                <p className="truncate text-[10px] text-muted-foreground">{email}</p>
              </div>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition", profileMenuOpen && "rotate-180")} />
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
