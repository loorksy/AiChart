"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, PanelLeftClose, PanelLeft, Menu, X, ChevronRight } from "lucide-react";
import { LonoraLogo } from "@/components/LonoraLogo";
import { navForRole, activeNav, type NavRole } from "@/components/shell/navConfig";
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
  const currentTab = searchParams.get("tab");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const items = navForRole(role);

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  /* ─── Nav list renderer ─── */
  const navList = (onNavigate?: () => void) => (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-3">
      {items.map((item) => {
        const active = activeNav(pathname, item, currentTab);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            title={collapsed && !onNavigate ? item.label : undefined}
            className={cn(
              "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 cursor-pointer border border-transparent",
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
              <span className="truncate">{item.label}</span>
            )}
            {active && !collapsed && (
              <ChevronRight className="ms-auto h-3.5 w-3.5 opacity-80 shrink-0" />
            )}
          </Link>
        );
      })}
    </nav>
  );

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
          <LonoraLogo
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
        className="rounded-lg p-1.5 text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
        aria-label={collapsed ? "توسيع القائمة" : "طيّ القائمة"}
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
          "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-all hover:bg-destructive/10 hover:text-destructive cursor-pointer border border-transparent",
          collapsed && "justify-center px-0",
        )}
        title={collapsed ? "خروج" : undefined}
      >
        <LogOut className="h-4 w-4" />
        {!collapsed && "خروج"}
      </button>
    </div>
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-background lg:flex-row relative">
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
        className="fixed start-3 top-3 z-30 rounded-lg border border-border bg-sidebar p-2.5 text-foreground shadow backdrop-blur-md lg:hidden cursor-pointer"
        aria-label="القائمة"
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
            aria-label="إغلاق"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 start-0 flex w-[min(80%,18rem)] flex-col border-e border-border bg-sidebar shadow-2xl">
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <Link href="/console" className="flex items-center gap-2.5">
                <LonoraLogo size={26} showName nameClassName="font-bold tracking-tight" />
              </Link>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                aria-label="إغلاق"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {navList(() => setMobileOpen(false))}
            <div className="border-t border-border p-3 space-y-1">
              <div className="px-3 pb-2 flex items-center gap-2">
                <div className="h-6 w-6 rounded-lg bg-accent text-accent-foreground border border-border flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-bold">
                    {displayName.charAt(0).toUpperCase()}
                  </span>
                </div>
                <p className="truncate text-xs text-muted-foreground font-medium">{displayName}</p>
              </div>
              <button
                type="button"
                onClick={() => void logout()}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive cursor-pointer border border-transparent"
              >
                <LogOut className="h-4 w-4" />
                خروج
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
            noPadding
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
