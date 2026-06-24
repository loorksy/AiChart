"use client";

import Link from "next/link";
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
  PanelRightOpen,
  Radar,
  Search,
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
import { cn } from "@/lib/utils";
import type { Conversation } from "@/lib/types";
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

export function ChatGptSidebar({
  pathname,
  role,
  collapsed,
  onToggleCollapse,
  onNewChat,
  conversations,
  selectedId,
  onChatPage,
  onSelectConversation,
  onDeleteConversation,
  displayName,
  email,
  initials,
  creditsRemaining,
  creditsLimit,
  creditsLoading,
  onLogout,
}: {
  pathname: string;
  role: "user" | "admin";
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNewChat: () => void;
  conversations: Conversation[];
  selectedId: number | null;
  onChatPage: boolean;
  onSelectConversation: (slug: string) => void;
  onDeleteConversation: (slug: string) => void;
  displayName: string;
  email: string;
  initials: string;
  creditsRemaining: number;
  creditsLimit: number;
  creditsLoading: boolean;
  onLogout: () => void;
}) {
  const { t, locale, setLocale } = useLocale();
  const { theme, setTheme, resolved: resolvedTheme } = useTheme();
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

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
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out md:flex",
        "border-e border-sidebar-border",
        collapsed ? "w-[3.75rem]" : "w-[17.5rem]",
      )}
    >
      {/* Brand & Toggle buttons */}
      <div
        className={cn(
          "flex items-center gap-1 p-3",
          collapsed ? "flex-col" : "justify-between px-4 pt-4",
        )}
      >
        {!collapsed && (
          <Link
            href="/chat"
            className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 transition hover:bg-sidebar-accent"
          >
            <img src="/logo.png" alt="AiChart" className="h-5 w-5 shrink-0 object-contain rounded-md" />
            <span className="truncate text-sm font-bold tracking-tight">AiChart</span>
          </Link>
        )}
        <div className={cn("flex items-center gap-0.5", collapsed && "flex-col")}>
          <button
            type="button"
            onClick={onToggleCollapse}
            className="rounded-lg p-2 text-muted-foreground transition hover:bg-sidebar-accent hover:text-foreground"
            aria-label={collapsed ? "توسيع القائمة" : "طي القائمة"}
            title={collapsed ? "توسيع" : "طي"}
          >
            {collapsed ? (
              <PanelRightOpen className="h-5 w-5" />
            ) : (
              <PanelRightClose className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      {/* New conversation trigger */}
      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={() => void onNewChat()}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl border border-sidebar-border bg-card/50 text-sm font-medium transition hover:bg-sidebar-accent",
            collapsed ? "justify-center p-2.5" : "px-4 py-2.5",
          )}
          title={t("sidebar.new_chat")}
        >
          <MessageSquarePlus className="h-4 w-4 shrink-0 text-primary" />
          {!collapsed && <span>{t("sidebar.new_chat")}</span>}
        </button>
      </div>

      {/* Main navigation list */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3">
        {MAIN_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = isTabActive(pathname, tab.href);
          const label = getTabLabel(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              title={collapsed ? label : undefined}
              data-active={active}
              className={cn(
                "sidebar-nav-item flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                active
                  ? "bg-sidebar-accent text-foreground font-semibold"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                collapsed && "justify-center px-2",
              )}
            >
              <Icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
              {!collapsed && <span>{label}</span>}
            </Link>
          );
        })}

        {/* Chat History Section */}
        <div className="mt-4 pt-2 border-t border-sidebar-border/60">
          {!collapsed && (
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {t("sidebar.recent_chats")}
            </p>
          )}
          <div className="space-y-0.5">
            {conversations.length === 0 && !collapsed ? (
              <p className="px-3 py-2 text-xs text-muted-foreground/60 italic">
                {t("sidebar.no_chats")}
              </p>
            ) : (
              conversations.map((c) => {
                const active = selectedId === c.id && onChatPage;
                return (
                  <div
                    key={c.id}
                    className={cn(
                      "group flex items-center rounded-lg transition",
                      active ? "bg-sidebar-accent/80" : "hover:bg-sidebar-accent/50",
                      collapsed && "justify-center",
                    )}
                  >
                    <Link
                      href="/chat"
                      onClick={() => void onSelectConversation(c.public_id)}
                      title={collapsed ? c.title : undefined}
                      className={cn(
                        "min-w-0 flex-1 truncate text-xs px-3 py-2 text-right transition font-medium",
                        active ? "text-foreground font-semibold" : "text-muted-foreground hover:text-foreground",
                        collapsed && "px-2 text-center",
                      )}
                    >
                      {collapsed ? (
                        <MessageSquare className="mx-auto h-4 w-4" />
                      ) : (
                        c.title
                      )}
                    </Link>
                    {!collapsed && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void onDeleteConversation(c.public_id);
                        }}
                        className="me-2 shrink-0 rounded-md p-1 text-muted-foreground/60 opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                        title={t("sidebar.delete")}
                        aria-label={t("sidebar.delete")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </nav>

      {/* Persistent User Profile Footer */}
      <div className="relative border-t border-sidebar-border p-3" ref={profileMenuRef}>
        {/* Profile Popover / Context Menu */}
        {profileMenuOpen && (
          <div className="absolute bottom-full start-0 z-50 mb-2 w-[calc(100%-1.5rem)] mx-3 overflow-hidden rounded-xl border border-border bg-popover p-2.5 shadow-xl animate-in slide-in-from-bottom-2 duration-150">
            {/* Account links */}
            <div className="space-y-1 pb-2 border-b border-border/60">
              <Link
                href="/settings"
                onClick={() => setProfileMenuOpen(false)}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-foreground transition hover:bg-secondary"
              >
                <Settings className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{t("profile.settings")}</span>
              </Link>
              <Link
                href="/dashboard"
                onClick={() => setProfileMenuOpen(false)}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-foreground transition hover:bg-secondary"
              >
                <LayoutDashboard className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{t("profile.analytics")}</span>
              </Link>
              <Link
                href="/settings#account"
                onClick={() => setProfileMenuOpen(false)}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-foreground transition hover:bg-secondary"
              >
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{t("profile.account")}</span>
              </Link>
              {role === "admin" && (
                <Link
                  href="/console"
                  onClick={() => setProfileMenuOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/10"
                >
                  <Shield className="h-3.5 w-3.5 text-primary" />
                  <span>{t("sidebar.admin")}</span>
                </Link>
              )}
            </div>

            {/* Interactive Theme Toggles (Flat Segmented) */}
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

            {/* Interactive Language Toggles (Flat Segmented) */}
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

            {/* Log out */}
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
          </div>
        )}

        {/* User Card trigger */}
        <div
          onClick={() => setProfileMenuOpen((o) => !o)}
          className={cn(
            "flex cursor-pointer items-center gap-2.5 rounded-xl p-2 transition-colors hover:bg-sidebar-accent",
            profileMenuOpen && "bg-sidebar-accent",
            collapsed && "justify-center px-1.5",
          )}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary border border-border text-xs font-bold text-foreground">
            {initials}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1 flex items-center justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight text-foreground">{displayName}</p>
                <p className="truncate text-[10px] text-muted-foreground">{email}</p>
              </div>
              <ChevronDown className={cn("h-4.5 w-4.5 text-muted-foreground transition", profileMenuOpen && "rotate-180")} />
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
