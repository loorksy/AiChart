"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Menu, PanelLeft, PanelLeftClose, X } from "lucide-react";
import { AiChartLogo } from "@/components/AiChartLogo";
import { NotificationCenter } from "@/components/agent/NotificationCenter";
import { SidebarProfileMenu } from "@/components/agent/SidebarProfileMenu";
import { SidebarConversations } from "@/components/shell/SidebarConversations";
import { ShellMenuProvider } from "@/components/shell/ShellMenuContext";
import { navForRole, activeNav, type NavRole } from "@/components/shell/navConfig";
import { useLocale } from "@/hooks/useLocale";
import { useMe } from "@/hooks/useMe";
import { Mt5PresencePing } from "@/components/Mt5PresencePing";
import { cn } from "@/lib/utils";

/**
 * Canonical console shell — role-aware sidebar / one mobile drawer.
 * Trader shell includes conversations; admin shell is admin destinations only.
 */
export function AppConsoleShell({
  role,
  displayName,
  children,
  noPadding = false,
  showConversations,
}: {
  role: NavRole;
  displayName: string;
  children: React.ReactNode;
  noPadding?: boolean;
  /** Override conversation section (default: traders only). */
  showConversations?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t, dir } = useLocale();
  const { data: me } = useMe();
  const currentTab = searchParams.get("tab");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [navPath, setNavPath] = useState(pathname);
  const mobileDrawerRef = useRef<HTMLElement | null>(null);
  const isAdmin = role === "admin";
  // Until /api/me resolves, keep non-admin nav conservative (trial-sized).
  const access =
    me?.entitlement?.access ?? (isAdmin ? "admin" : "trial");
  const items = navForRole(role, access);
  const paidWorkspace = access === "full" || access === "admin";
  const conversationsEnabled =
    showConversations ?? (!isAdmin && paidWorkspace);
  const showChartMenu =
    !isAdmin &&
    paidWorkspace &&
    (pathname === "/console" || pathname.startsWith("/chart"));
  const workspaceNoPadding =
    noPadding ||
    pathname === "/console" ||
    pathname.startsWith("/chart") ||
    pathname === "/subscribe";
  /** Chart pages host the menu in the chart toolbar; other pages use a page header. */
  const needsPageMenu = !showChartMenu;

  if (pathname !== navPath) {
    setNavPath(pathname);
    if (mobileOpen) setMobileOpen(false);
  }

  useEffect(() => {
    if (!mobileOpen) return;
    document.body.style.overflow = "hidden";
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const drawer = mobileDrawerRef.current;
    const selector =
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () =>
      Array.from(drawer?.querySelectorAll<HTMLElement>(selector) ?? []);
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

  const menuApi = useMemo(
    () => ({
      openMobileMenu: () => setMobileOpen(true),
      closeMobileMenu: () => setMobileOpen(false),
      mobileOpen,
    }),
    [mobileOpen, setMobileOpen],
  );

  const navList = (onNavigate?: () => void) => (
    <nav
      data-testid={isAdmin ? "canonical-admin-nav" : "canonical-product-nav"}
      className="flex shrink-0 flex-col gap-0.5 px-2 py-2"
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
              "relative flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
              collapsed && !onNavigate && "justify-center px-0",
              active
                ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-active-text)]"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {active && (
              <span
                aria-hidden
                className="absolute inset-y-2 start-0 w-0.5 rounded-full bg-foreground"
              />
            )}
            <Icon className={cn("shrink-0", collapsed && !onNavigate ? "h-5 w-5" : "h-4 w-4")} />
            {(!collapsed || onNavigate) && <span className="truncate">{label}</span>}
          </Link>
        );
      })}
    </nav>
  );

  const brandHref = isAdmin ? "/console" : "/console";

  const sidebarHeader = (
    <div
      className={cn(
        "flex h-14 shrink-0 items-center border-b border-sidebar-border px-3",
        collapsed ? "justify-center" : "justify-between gap-2",
      )}
    >
      {!collapsed ? (
        <Link
          href={brandHref}
          className="flex min-w-0 items-center gap-2 overflow-visible"
          data-testid="sidebar-brand"
        >
          <AiChartLogo
            size={36}
            showName
            nameClassName="truncate text-[15px] font-semibold tracking-tight"
          />
        </Link>
      ) : (
        <Link href={brandHref} className="flex items-center justify-center overflow-visible">
          <AiChartLogo size={30} />
        </Link>
      )}
      {!collapsed ? (
        <div className="flex shrink-0 items-center gap-0.5">
          {/* Alert bell + notification center (Group 9). */}
          <NotificationCenter />
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="hidden size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground lg:flex"
            aria-label={t("shell.collapse_sidebar")}
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="hidden size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground lg:flex"
          aria-label={t("shell.expand_sidebar")}
        >
          <PanelLeft className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  return (
    <ShellMenuProvider value={menuApi}>
      {/* V2-B: presence beat drives the MetaApi deploy/undeploy cost saver. */}
      <Mt5PresencePing />
      <div
        dir={dir}
        data-testid="app-console-shell"
        data-shell-role={role}
        className="relative flex h-dvh overflow-hidden bg-background lg:flex-row"
      >
        <aside
          data-testid="canonical-desktop-sidebar"
          className={cn(
            "z-20 hidden h-full shrink-0 flex-col border-e border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex",
            collapsed ? "w-[3.75rem]" : "w-[260px]",
          )}
        >
          {sidebarHeader}
          {navList()}
          {conversationsEnabled ? <SidebarConversations collapsed={collapsed} /> : (
            <div className="flex-1" />
          )}
          <SidebarProfileMenu collapsed={collapsed} displayName={displayName} />
        </aside>

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
                <Link href={brandHref} className="flex min-w-0 items-center overflow-visible">
                  <AiChartLogo size={32} showName nameClassName="truncate text-[15px] font-semibold" />
                </Link>
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
                  aria-label={t("shell.close")}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              {navList(() => setMobileOpen(false))}
              {conversationsEnabled ? (
                <SidebarConversations onNavigate={() => setMobileOpen(false)} />
              ) : (
                <div className="flex-1" />
              )}
              <SidebarProfileMenu displayName={displayName} />
            </aside>
          </div>
        )}

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
          {needsPageMenu ? (
            <div
              data-testid="page-toolbar-menu"
              className="flex h-12 shrink-0 items-center border-b border-border px-3 lg:hidden"
            >
              <button
                type="button"
                data-testid="mobile-menu-trigger"
                onClick={() => setMobileOpen(true)}
                className="flex size-10 items-center justify-center rounded-lg border border-border bg-background text-foreground"
                aria-label={t("shell.open_menu")}
                aria-expanded={mobileOpen}
                aria-controls="mobile-navigation-drawer"
              >
                <Menu className="h-5 w-5" />
              </button>
              {/* Mobile bell: the sidebar (and its bell) is hidden below lg. */}
              <NotificationCenter className="ms-auto" />
            </div>
          ) : null}
          <main
            className={cn(
              "aichart-scroll flex min-h-0 flex-1 flex-col",
              workspaceNoPadding
                ? "overflow-hidden"
                : "overflow-y-auto px-4 pb-6 pt-4 sm:px-6 sm:pb-8 lg:pt-6",
            )}
          >
            {children}
          </main>
        </div>
      </div>
    </ShellMenuProvider>
  );
}
