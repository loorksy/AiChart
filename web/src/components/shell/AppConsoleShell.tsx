"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Languages, LogOut, PanelLeftClose, PanelLeft, Menu, X, ChevronRight, MessageSquarePlus, MessagesSquare, Settings, UserRound } from "lucide-react";
import { AiChartLogo } from "@/components/AiChartLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { navForRole, activeNav, type NavRole } from "@/components/shell/navConfig";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import { GridPattern } from "@/components/ui/grid-pattern";

/**
 * Premium OLED-dark console shell with collapsible glassmorphism sidebar,
 * green active indicators, and smooth Framer-style transitions.
 * Replaces UserShell / BridgeShell / AppShell / AdminShell.
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
  const [recentChats, setRecentChats] = useState<Array<{ id: string; title: string }>>([]);
  const items = navForRole(role);
  const workspaceNoPadding = noPadding || pathname === "/console";

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen || role === "admin") return;
    void fetch("/api/agent/chats?limit=5")
      .then((res) => res.ok ? res.json() : null)
      .then((data: { sessions?: Array<{ id: string; title: string }> } | null) =>
        setRecentChats(data?.sessions ?? []),
      )
      .catch(() => setRecentChats([]));
  }, [mobileOpen, role]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const drawer = mobileDrawerRef.current;
    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () => Array.from(drawer?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
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
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [mobileOpen]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  /* ─── Nav list renderer ─── */
  const navList = (onNavigate?: () => void, embedded = false) => (
    <nav className={cn("flex flex-col gap-0.5 px-2 py-3", !embedded && "flex-1 overflow-y-auto")}>
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
            className={cn(
              "group relative flex min-h-11 items-center gap-3 rounded-lg border border-transparent px-3 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
              collapsed && !onNavigate && "justify-center px-0",
              active
                ? "bg-primary text-primary-foreground border-border"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon
              className={cn(
                "shrink-0 transition-colors",
                collapsed && !onNavigate ? "h-5 w-5" : "h-4 w-4",
                active ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground",
              )}
            />
            {(!collapsed || onNavigate) && (
              <span className="truncate">{label}</span>
            )}
            {active && !collapsed && (
              <ChevronRight className="ms-auto h-3.5 w-3.5 shrink-0 opacity-80 rtl:rotate-180" />
            )}
          </Link>
        );
      })}
    </nav>
  );

  function selectMobileChat(id: string) {
    localStorage.setItem("lonora_active_chat", id);
    if (pathname === "/console") {
      window.dispatchEvent(new CustomEvent("aichart:select-chat", { detail: { id } }));
    } else {
      router.push("/console");
    }
    setMobileOpen(false);
  }

  async function startMobileChat() {
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
      if (data.session?.id) localStorage.setItem("lonora_active_chat", data.session.id);
    }
    router.push("/console");
    setMobileOpen(false);
  }

  /* ─── Sidebar header ─── */
  const sidebarHeader = (
    <div
      className={cn(
        "flex h-14 items-center border-b border-border px-3",
        collapsed ? "justify-center" : "justify-between",
      )}
    >
      {!collapsed && (
        <Link href="/console" className="flex items-center gap-2.5 group">
          <AiChartLogo
            size={28}
            showName
            nameClassName="font-bold tracking-tight text-foreground"
            className="group-hover:opacity-90"
          />
        </Link>
      )}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={collapsed ? t("shell.expand_sidebar") : t("shell.collapse_sidebar")}
      >
        {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
      </button>
    </div>
  );

  /* ─── Sidebar footer (user + logout) ─── */
  const sidebarFooter = (
    <div className="border-t border-border p-3 space-y-1">
      {!collapsed && (
        <div className="px-3 pb-2 flex items-center gap-2">
          <div className="h-6 w-6 rounded-lg bg-accent text-accent-foreground border border-border flex items-center justify-center shrink-0">
            <span className="text-[10px] font-bold">
              {displayName.charAt(0).toUpperCase()}
            </span>
          </div>
          <p className="truncate text-xs text-muted-foreground font-medium">{displayName}</p>
        </div>
      )}
      <button
        type="button"
        onClick={() => void logout()}
        className={cn(
          "flex min-h-11 w-full items-center gap-2.5 rounded-lg border border-transparent px-3 text-sm text-muted-foreground transition-all hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
          collapsed && "justify-center px-0",
        )}
        title={collapsed ? t("profile.logout") : undefined}
      >
        <LogOut className="h-4 w-4" />
        {!collapsed && t("profile.logout")}
      </button>
    </div>
  );

  return (
    <div dir={dir} className="relative flex h-dvh overflow-hidden bg-background lg:flex-row">
      {/* ─── Desktop sidebar — fixed width; only main content grows on resize ─── */}
      <aside
        className={cn(
          "hidden h-full shrink-0 flex-col border-e border-border bg-sidebar transition-[width] duration-200 ease-in-out lg:flex z-10",
          collapsed ? "w-[3.75rem]" : "w-60",
        )}
      >
        {sidebarHeader}
        {navList()}
        {sidebarFooter}
      </aside>

      {/* ─── Mobile hamburger button ─── */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed start-3 top-3 z-30 flex size-11 items-center justify-center rounded-lg border border-border bg-sidebar text-foreground shadow backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden cursor-pointer"
        aria-label={t("shell.open_menu")}
        aria-expanded={mobileOpen}
        aria-controls="mobile-navigation-drawer"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* ─── Mobile slide-in sidebar drawer ─── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* backdrop */}
          <button
            type="button"
            className="absolute inset-0 bg-black/75 backdrop-blur-xs"
            aria-label={t("shell.close")}
            onClick={() => setMobileOpen(false)}
          />
          <aside
            ref={mobileDrawerRef}
            id="mobile-navigation-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={t("shell.navigation_account")}
            className="absolute inset-y-0 start-0 flex w-[min(80%,18rem)] flex-col border-e border-border bg-sidebar shadow-2xl"
          >
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <Link href="/console" className="flex items-center gap-2.5">
                <AiChartLogo size={26} showName nameClassName="font-bold tracking-tight" />
              </Link>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                aria-label={t("shell.close")}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-2">
              <p className="px-5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("shell.product")}
              </p>
              {navList(() => setMobileOpen(false), true)}
              {role !== "admin" && (
                <div className="border-t border-border px-2 pt-3">
                  <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("shell.chat")}
                  </p>
                  <button
                    type="button"
                    onClick={() => void startMobileChat()}
                    className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <MessageSquarePlus className="h-4 w-4" />
                    {t("nav.new_chat")}
                  </button>
                  {recentChats.map((session) => (
                    <button
                      type="button"
                      key={session.id}
                      onClick={() => selectMobileChat(session.id)}
                      className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-start text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <MessagesSquare className="h-4 w-4 shrink-0" />
                      <span className="truncate">{session.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t border-border p-3 space-y-1">
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("shell.account")}
              </p>
              <div className="px-3 pb-2 flex items-center gap-2">
                <div className="h-6 w-6 rounded-lg bg-accent text-accent-foreground border border-border flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-bold">
                    {displayName.charAt(0).toUpperCase()}
                  </span>
                </div>
                <p className="truncate text-xs text-muted-foreground font-medium">{displayName}</p>
              </div>
              <Link
                href="/console/settings/profile"
                onClick={() => setMobileOpen(false)}
                className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <UserRound className="h-4 w-4" />
                {t("profile.profile")}
              </Link>
              <div className="flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm text-muted-foreground">
                <Languages className="h-4 w-4 shrink-0" />
                <span>{t("shell.language")}</span>
                <div className="ms-auto"><LanguageSwitcher variant="inline" /></div>
              </div>
              <Link
                href="/console/settings"
                onClick={() => setMobileOpen(false)}
                className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Settings className="h-4 w-4" />
                {t("nav.settings")}
              </Link>
              <button
                type="button"
                onClick={() => void logout()}
                className="flex min-h-11 w-full items-center gap-2.5 rounded-lg border border-transparent px-3 text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
                {t("profile.logout")}
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* ─── Page content — fills remaining viewport beside sidebar ─── */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden relative">
        <GridPattern className="pointer-events-none opacity-30 z-0" />
        <main
          className={cn(
            "flex min-h-0 flex-1 flex-col z-10",
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
