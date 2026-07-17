"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Languages,
  LogOut,
  PanelLeftClose,
  PanelLeft,
  Menu,
  X,
  MessageSquarePlus,
  MessagesSquare,
  Settings,
  UserRound,
} from "lucide-react";
import { AiChartLogo } from "@/components/AiChartLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { navForRole, activeNav, type NavRole } from "@/components/shell/navConfig";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

/**
 * Canonical console shell — one opaque sidebar (product nav + conversations),
 * one mobile drawer. No second navigation column on desktop.
 */
export function AppConsoleShell({
  role,
  displayName,
  children,
  noPadding = false,
}: {
  role: NavRole;
  displayName: string;
  children: React.ReactNode;
  noPadding?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, dir } = useLocale();
  const currentTab = searchParams.get("tab");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileDrawerRef = useRef<HTMLElement | null>(null);
  const [recentChats, setRecentChats] = useState<
    Array<{ id: string; title: string; lastMessagePreview?: string | null }>
  >([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const items = navForRole(role);
  const workspaceNoPadding = noPadding || pathname === "/console";
  const showChats = role !== "admin";

  const loadChats = useCallback(() => {
    if (!showChats) return;
    void fetch("/api/agent/chats?limit=20")
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (data: {
          sessions?: Array<{
            id: string;
            title: string;
            lastMessagePreview?: string | null;
          }>;
        } | null) => setRecentChats(data?.sessions ?? []),
      )
      .catch(() => setRecentChats([]));
    if (typeof window !== "undefined") {
      setActiveChatId(localStorage.getItem("lonora_active_chat"));
    }
  }, [showChats]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    loadChats();
  }, [loadChats, pathname]);

  useEffect(() => {
    if (!showChats) return;
    const onUpdated = () => loadChats();
    window.addEventListener("aichart:chats-updated", onUpdated);
    window.addEventListener("storage", onUpdated);
    return () => {
      window.removeEventListener("aichart:chats-updated", onUpdated);
      window.removeEventListener("storage", onUpdated);
    };
  }, [loadChats, showChats]);

  useEffect(() => {
    if (!mobileOpen) return;
    document.body.style.overflow = "hidden";
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const drawer = mobileDrawerRef.current;
    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () =>
      Array.from(drawer?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
    focusables()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusables();
      if (!nodes.length) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [mobileOpen]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  function selectChat(id: string) {
    localStorage.setItem("lonora_active_chat", id);
    setActiveChatId(id);
    if (pathname === "/console") {
      window.dispatchEvent(new CustomEvent("aichart:select-chat", { detail: { id } }));
    } else {
      router.push("/console");
    }
    setMobileOpen(false);
  }

  async function startChat() {
    if (pathname === "/console") {
      window.dispatchEvent(new Event("aichart:new-chat"));
      setMobileOpen(false);
      return;
    }
    const res = await fetch("/api/agent/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (res.ok) {
      const data = (await res.json()) as { session?: { id: string } };
      if (data.session?.id) {
        localStorage.setItem("lonora_active_chat", data.session.id);
        setActiveChatId(data.session.id);
      }
    }
    router.push("/console");
    setMobileOpen(false);
  }

  const navList = (onNavigate?: () => void, embedded = false) => (
    <nav
      data-testid="canonical-product-nav"
      className={cn("flex flex-col gap-0.5 px-2", !embedded && "pb-2")}
    >
      {items.map((item) => {
        const active = activeNav(pathname, item, currentTab);
        const Icon = item.icon;
        const label = t(item.labelKey);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            title={collapsed && !onNavigate ? label : undefined}
            data-active={active ? "true" : undefined}
            className={cn(
              "sidebar-nav-item relative min-h-10",
              collapsed && !onNavigate && "justify-center px-0",
              active
                ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-active-text)]"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {active && (
              <span
                aria-hidden
                className="absolute inset-y-2 start-0 w-0.5 rounded-full bg-primary"
              />
            )}
            <Icon
              className={cn(
                "shrink-0",
                collapsed && !onNavigate ? "h-5 w-5" : "h-4 w-4",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            />
            {(!collapsed || onNavigate) && (
              <span className="truncate">{label}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const chatsSection = (onNavigate?: () => void) => {
    if (!showChats || (collapsed && !onNavigate)) return null;
    return (
      <div
        data-testid="canonical-chats-section"
        className="border-t border-sidebar-border px-2 pt-3"
      >
        <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("shell.chat")}
        </p>
        <button
          type="button"
          onClick={() => void startChat()}
          className="mb-1 flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MessageSquarePlus className="h-4 w-4 shrink-0" />
          {t("nav.new_chat")}
        </button>
        <div className="flex flex-col gap-0.5">
          {recentChats.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">{t("nav.no_chats")}</p>
          ) : (
            recentChats.map((session) => {
              const active = session.id === activeChatId;
              return (
                <button
                  type="button"
                  key={session.id}
                  onClick={() => selectChat(session.id)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-start text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-[var(--sidebar-active-bg)] text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <MessagesSquare className="h-4 w-4 shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1 truncate">{session.title}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    );
  };

  const sidebarHeader = (
    <div
      className={cn(
        "flex h-14 shrink-0 items-center border-b border-sidebar-border px-3",
        collapsed ? "justify-center" : "justify-between gap-2",
      )}
    >
      {!collapsed ? (
        <Link
          href="/console"
          className="flex min-w-0 items-center gap-2 overflow-visible"
          data-testid="sidebar-brand"
        >
          <AiChartLogo
            size={32}
            showName
            nameClassName="truncate text-[15px] font-semibold tracking-tight text-foreground"
          />
        </Link>
      ) : (
        <Link href="/console" className="flex items-center justify-center" title="AiChart">
          <AiChartLogo size={28} />
        </Link>
      )}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className={cn(
          "hidden size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:flex",
          collapsed && "mt-0",
        )}
        aria-label={collapsed ? t("shell.expand_sidebar") : t("shell.collapse_sidebar")}
      >
        {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
      </button>
    </div>
  );

  const accountFooter = (compact: boolean) => (
    <div className="shrink-0 border-t border-sidebar-border p-2 space-y-0.5">
      {!compact && (
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-muted text-[11px] font-semibold text-foreground">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <p className="truncate text-xs font-medium text-muted-foreground">{displayName}</p>
        </div>
      )}
      {!compact && (
        <>
          <Link
            href="/console/settings/profile"
            onClick={() => setMobileOpen(false)}
            className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <UserRound className="h-4 w-4" />
            {t("profile.profile")}
          </Link>
          <div className="flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm text-muted-foreground">
            <Languages className="h-4 w-4 shrink-0" />
            <span className="truncate">{t("shell.language")}</span>
            <div className="ms-auto">
              <LanguageSwitcher variant="inline" />
            </div>
          </div>
          <Link
            href="/console/settings"
            onClick={() => setMobileOpen(false)}
            className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
            {t("nav.settings")}
          </Link>
        </>
      )}
      <ThemeToggle collapsed={compact} />
      <button
        type="button"
        onClick={() => void logout()}
        className={cn(
          "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          compact && "justify-center px-0",
        )}
        title={compact ? t("profile.logout") : undefined}
      >
        <LogOut className="h-4 w-4" />
        {!compact && t("profile.logout")}
      </button>
    </div>
  );

  return (
    <div
      dir={dir}
      data-testid="app-console-shell"
      className="relative flex h-dvh overflow-hidden bg-background lg:flex-row"
    >
      {/* Single canonical desktop sidebar */}
      <aside
        data-testid="canonical-desktop-sidebar"
        className={cn(
          "hidden h-full shrink-0 flex-col border-e border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-in-out lg:flex z-20",
          collapsed ? "w-[3.75rem]" : "w-[260px]",
        )}
      >
        {sidebarHeader}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-2">
          {navList()}
          {chatsSection()}
        </div>
        {accountFooter(collapsed)}
      </aside>

      <button
        type="button"
        data-testid="mobile-menu-trigger"
        onClick={() => setMobileOpen(true)}
        className="fixed start-3 top-3 z-30 flex size-10 items-center justify-center rounded-lg border border-border bg-background text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
        aria-label={t("shell.open_menu")}
        aria-expanded={mobileOpen}
        aria-controls="mobile-navigation-drawer"
      >
        <Menu className="h-5 w-5" />
      </button>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" data-testid="canonical-mobile-drawer">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label={t("shell.close")}
            onClick={() => setMobileOpen(false)}
          />
          <aside
            ref={mobileDrawerRef}
            id="mobile-navigation-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={t("shell.navigation_account")}
            className="absolute inset-y-0 start-0 flex w-[min(86%,17.5rem)] flex-col border-e border-sidebar-border bg-sidebar text-sidebar-foreground shadow-xl"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-sidebar-border px-3">
              <Link href="/console" className="flex min-w-0 items-center overflow-visible">
                <AiChartLogo
                  size={30}
                  showName
                  nameClassName="truncate text-[15px] font-semibold"
                />
              </Link>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={t("shell.close")}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-2">
              <p className="px-4 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("shell.product")}
              </p>
              {navList(() => setMobileOpen(false), true)}
              {chatsSection(() => setMobileOpen(false))}
            </div>
            {accountFooter(false)}
          </aside>
        </div>
      )}

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <main
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            workspaceNoPadding
              ? "overflow-hidden"
              : "overflow-y-auto px-4 pb-6 pt-14 sm:px-6 sm:pb-8 lg:pt-6",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
