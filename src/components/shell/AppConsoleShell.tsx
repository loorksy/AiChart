"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { PanelLeft, PanelLeftClose, ShieldCheck, X } from "lucide-react";
import { AiChartLogo } from "@/components/AiChartLogo";
import { ProfileAccountSheet } from "@/components/agent/SidebarProfileMenu";
import { ConsoleOverlaysProvider } from "@/components/shell/ConsoleOverlays";
import type { SettingsTabId } from "@/components/SettingsClient";
import { settingsPath, rememberSettingsReturn } from "@/lib/settings/paths";
import { SidebarConversations } from "@/components/shell/SidebarConversations";
import { ShellMenuProvider } from "@/components/shell/ShellMenuContext";
import { SheetCoordinatorProvider, useSheetSlot } from "@/components/shell/SheetCoordinator";
import { ConsoleTopBar } from "@/components/shell/ConsoleTopBar";
import { ServerLinkBanner } from "@/components/shell/ServerLinkBanner";
import {
  navForRole,
  activeNav,
  type NavItem,
  type NavRole,
} from "@/components/shell/navConfig";
import { useLocale } from "@/hooks/useLocale";
import { useMe } from "@/hooks/useMe";
import { cn } from "@/lib/utils";

/**
 * The admin console is a separate application (see admin_flutter/), served
 * at this path. An admin's rail is the ordinary product rail plus this one
 * link out: the grouped admin tree that used to live here belonged to the
 * in-app panel, which no longer exists.
 */
const ADMIN_APP_PATH = "/admin-app/";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar";

/**
 * Shared geometry for every destination in the rail, so the trader's flat list
 * and the admin's grouped tree are literally the same control. 44px on touch,
 * tightened to 40px from `lg` where the pointer is a mouse.
 */
function navLinkClass(active: boolean, iconOnly: boolean): string {
  return cn(
    "relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150 ease-out lg:min-h-10",
    FOCUS_RING,
    iconOnly && "justify-center px-0",
    active
      ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-active-text)]"
      : "text-muted-foreground hover:bg-muted hover:text-foreground",
  );
}

/** Start-edge marker; `start-0` keeps it on the reading edge in both directions. */
function ActiveMarker() {
  return (
    <span
      aria-hidden
      className="absolute inset-y-2 start-0 w-0.5 rounded-full bg-foreground"
    />
  );
}

/**
 * Canonical console shell — role-aware sidebar / one mobile drawer.
 *
 * This is the ONLY navigation on any console surface. `/console/platform` used
 * to mount a second rail of its own next to this one; the admin's grouped
 * destination tree was folded in here instead, so an admin sees one nav with
 * every `?tab=` deep link in it rather than two competing ones.
 *
 * Trader shell includes conversations; admin shell is admin destinations only.
 */
type AppConsoleShellProps = {
  role: NavRole;
  displayName: string;
  children: React.ReactNode;
  noPadding?: boolean;
  /** Override conversation section (default: traders only). */
  showConversations?: boolean;
};

export function AppConsoleShell(props: AppConsoleShellProps) {
  // Wraps `children` too: the workspace's chart sheet has to share the single
  // overlay slot with this shell's nav drawer and profile sheet.
  return (
    <SheetCoordinatorProvider>
      <ConsoleShellBody {...props} />
    </SheetCoordinatorProvider>
  );
}

function ConsoleShellBody({
  role,
  displayName,
  children,
  noPadding = false,
  showConversations,
}: AppConsoleShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, dir, locale } = useLocale();
  const { data: me } = useMe();
  const currentTab = searchParams.get("tab");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useSheetSlot("sidebarDrawer");
  const [navPath, setNavPath] = useState(pathname);
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({});
  const mobileDrawerRef = useRef<HTMLElement | null>(null);
  const isAdmin = role === "admin";
  // Until /api/me resolves, keep non-admin nav conservative (trial-sized).
  const access =
    me?.entitlement?.access ?? (isAdmin ? "admin" : "trial");
  const items = navForRole(role, access);
  const paidWorkspace = access === "full" || access === "admin";
  const conversationsEnabled =
    showConversations ?? (!isAdmin && paidWorkspace);
  const workspaceNoPadding =
    noPadding ||
    pathname === "/chat" ||
    pathname.startsWith("/chart") ||
    // Support is the agent chat's surface: same chrome-free main, the chat
    // component owns its own scroll region and docked composer.
    pathname === "/console/support" ||
    pathname === "/subscribe";

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

  const overlaysApi = useMemo(
    () => ({
      openSettings: (tab?: SettingsTabId) => {
        const id = !tab || tab === "subscription" ? "profile" : tab;
        const search = searchParams.toString();
        rememberSettingsReturn(search ? `${pathname}?${search}` : pathname);
        router.push(settingsPath(id));
      },
    }),
    [pathname, router, searchParams],
  );

  const productLink = (item: NavItem, iconOnly: boolean, onNavigate?: () => void) => {
    const active = activeNav(pathname, item, currentTab);
    const Icon = item.icon;
    const label = t(item.labelKey);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        title={iconOnly ? label : undefined}
        aria-current={active ? "page" : undefined}
        data-active={active ? "true" : undefined}
        className={navLinkClass(active, iconOnly)}
      >
        {active && <ActiveMarker />}
        <Icon className={cn("shrink-0", iconOnly ? "h-5 w-5" : "h-4 w-4")} />
        {!iconOnly && <span className="truncate">{label}</span>}
        {iconOnly && <span className="sr-only">{label}</span>}
      </Link>
    );
  };

  const productNav = (iconOnly: boolean, onNavigate?: () => void) => (
    <nav
      data-testid="canonical-product-nav"
      aria-label={t("shell.product")}
      className="flex shrink-0 flex-col gap-0.5 px-2 py-2"
    >
      {items.map((item) => productLink(item, iconOnly, onNavigate))}
      {isAdmin && (
        <>
          <span aria-hidden className="my-2 h-px shrink-0 bg-sidebar-border" />
          {/* A plain anchor, not next/link: the console is a separate
              application served at this path, so the client router must not
              try to resolve it as a route of this app. */}
          <a
            data-testid="admin-console-link"
            href={ADMIN_APP_PATH}
            onClick={onNavigate}
            title={iconOnly ? t("shell.adminConsole") : undefined}
            className={navLinkClass(false, iconOnly)}
          >
            <ShieldCheck
              className={cn("shrink-0", iconOnly ? "h-5 w-5" : "h-4 w-4")}
            />
            {!iconOnly && (
              <span className="truncate">{t("shell.adminConsole")}</span>
            )}
            {iconOnly && <span className="sr-only">{t("shell.adminConsole")}</span>}
          </a>
        </>
      )}
    </nav>
  );

  const navList = (onNavigate?: () => void) => {
    // The drawer is never icon-only: it is only ever mounted at full width.
    const iconOnly = collapsed && !onNavigate;
    return productNav(iconOnly, onNavigate);
  };

  const brandHref = "/chat";

  const sidebarHeader = (
    <div
      className={cn(
        "flex h-14 shrink-0 items-center border-b border-sidebar-border px-3",
        collapsed ? "justify-center" : "justify-between gap-2",
      )}
    >
      {!collapsed ? (
        <>
          <Link
            href={brandHref}
            className={cn(
              "flex min-w-0 items-center gap-2 overflow-visible rounded-lg",
              FOCUS_RING,
            )}
            data-testid="sidebar-brand"
          >
            <AiChartLogo
              size={36}
              showName
              nameClassName="truncate text-[15px] font-semibold tracking-tight"
            />
          </Link>
          {/* The collapse control lives on the surface it collapses — reaching
              across the screen to the top bar to fold the rail put cause and
              effect in different corners. */}
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            data-testid="sidebar-collapse"
            className={cn(
              "hidden size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground lg:flex",
              FOCUS_RING,
            )}
            aria-label={t("shell.collapse_sidebar")}
          >
            <PanelLeftClose className="h-4 w-4 rtl:-scale-x-100" />
          </button>
        </>
      ) : (
        /**
         * Collapsed rail: ONE control, not a brand link sitting next to an
         * expand button — 60px of rail cannot host both legibly. The mark is
         * what you see at rest; pointing at it (or tabbing to it) crossfades to
         * the expand affordance. `focus-visible` mirrors `hover` so the control
         * is not mouse-only, and it earns a visible ring because the swap costs
         * it the logo as its resting identity cue.
         *
         * Clicking it ALWAYS expands and never navigates: a control that both
         * navigates and toggles gives one hit target two outcomes the user
         * cannot tell apart. Home stays reachable from the nav list below, and
         * the brand is a real link again the moment the rail is expanded.
         */
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          data-testid="sidebar-expand-brand"
          className={cn(
            "group relative hidden size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground lg:flex",
            FOCUS_RING,
          )}
          aria-label={t("shell.expand_sidebar")}
        >
          <span
            aria-hidden
            className="pointer-events-none flex items-center justify-center opacity-100 transition-opacity duration-200 ease-in-out group-hover:opacity-0 group-focus-visible:opacity-0 motion-reduce:duration-100"
          >
            <AiChartLogo size={30} />
          </span>
          <PanelLeft
            aria-hidden
            className="pointer-events-none absolute h-4 w-4 opacity-0 transition-opacity duration-200 ease-in-out group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:duration-100 rtl:-scale-x-100"
          />
        </button>
      )}
    </div>
  );

  return (
    <ShellMenuProvider value={menuApi}>
      <ConsoleOverlaysProvider value={overlaysApi}>
      {/* Console chrome — chart and chat stay in the same shell. */}
      <div
        dir={dir}
        data-testid="app-console-shell"
        data-shell-role={role}
        className="relative flex h-dvh overflow-hidden bg-background lg:flex-row"
      >
        <aside
          data-testid="canonical-desktop-sidebar"
          className={cn(
            "z-20 hidden h-full shrink-0 flex-col border-e border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out lg:flex",
            collapsed ? "w-[3.75rem]" : "w-[260px]",
          )}
        >
          {sidebarHeader}
          {navList()}
          {conversationsEnabled ? <SidebarConversations collapsed={collapsed} /> : null}
          {!isAdmin && !conversationsEnabled ? <div className="flex-1" /> : null}
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
                <Link href={brandHref} className={cn("flex min-w-0 items-center overflow-visible rounded-lg", FOCUS_RING)}>
                  <AiChartLogo size={32} showName nameClassName="truncate text-[15px] font-semibold" />
                </Link>
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted",
                    FOCUS_RING,
                  )}
                  aria-label={t("shell.close")}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              {navList(() => setMobileOpen(false))}
              {conversationsEnabled ? (
                <SidebarConversations onNavigate={() => setMobileOpen(false)} />
              ) : null}
              {!isAdmin && !conversationsEnabled ? <div className="flex-1" /> : null}
              {/*
                No language row here. The drawer used to show this switcher AND
                a language submenu inside the account sheet one row below it —
                two different controls for one setting, stacked. The account
                sheet keeps it; the drawer footer gives it up.
              */}
            </aside>
          </div>
        )}

        {/*
          Mounted by the shell, not by the menus that open them: the drawer that
          hosts the account trigger is unmounted the moment the account sheet
          takes the overlay slot, and an overlay cannot outlive its own trigger.
        */}
        <ProfileAccountSheet displayName={displayName} />

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
          <ConsoleTopBar
            displayName={displayName}
            sidebarOpen={mobileOpen}
            onToggleSidebar={() => setMobileOpen(!mobileOpen)}
            // Library header is hidden; traders refresh candles from here.
            refreshMode={isAdmin ? "page" : "chart"}
            showBalance={!isAdmin}
            showAccountStatus={!isAdmin}
            // Home composer (no ?chat=) hides the chart icon — that screen is
            // a question, not a chart summoner. Deep-linked chats keep it.
            showChartToggle={
              !isAdmin &&
              (pathname.startsWith("/chart") ||
                (pathname === "/chat" && Boolean(searchParams.get("chat"))))
            }
          />
          <ServerLinkBanner />
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
      </ConsoleOverlaysProvider>
    </ShellMenuProvider>
  );
}
