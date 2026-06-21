"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, PanelLeftClose, PanelLeft, Menu, X } from "lucide-react";
import { navForRole, activeNav, type NavRole } from "@/components/shell/navConfig";
import { cn } from "@/lib/utils";

/**
 * Unified professional shell for /console and /chat (both roles). Collapsible
 * sidebar + sticky mobile bottom nav. Dark-first, subtle accents (per the
 * persisted design system: OLED dark, green/positive accents, no layout-shift
 * hover). Replaces UserShell / BridgeShell / AppShell / AdminShell.
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
  /** Full-bleed content (e.g. the chat surface manages its own layout). */
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

  const navList = (onNavigate?: () => void) => (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
      {items.map((item) => {
        const active = activeNav(pathname, item, currentTab);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
              collapsed && !onNavigate && "justify-center px-0",
              active
                ? "bg-primary/15 font-semibold text-primary ring-1 ring-primary/20"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
            )}
          >
            <Icon className="h-4.5 w-4.5 shrink-0" />
            {(!collapsed || onNavigate) && <span className="truncate">{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-dvh flex-col bg-background lg:flex-row">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col border-l border-border bg-sidebar transition-[width] duration-200 lg:flex",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <div
          className={cn(
            "flex h-16 items-center border-b border-border/70 px-4",
            collapsed ? "justify-center" : "justify-between",
          )}
        >
          {!collapsed && (
            <Link href="/console" className="flex items-center gap-2">
              <Image src="/logo.png" alt="AiChart" width={28} height={28} className="rounded-lg" />
              <span className="font-bold tracking-tight">AiChart</span>
            </Link>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            aria-label={collapsed ? "توسيع القائمة" : "طيّ القائمة"}
          >
            {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        {navList()}

        <div className="border-t border-border/70 p-3">
          {!collapsed && (
            <p className="truncate px-2 pb-2 text-xs text-muted-foreground">{displayName}</p>
          )}
          <button
            type="button"
            onClick={() => void logout()}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
              collapsed && "justify-center px-0",
            )}
            title={collapsed ? "خروج" : undefined}
          >
            <LogOut className="h-4 w-4" />
            {!collapsed && "خروج"}
          </button>
        </div>
      </aside>

      {/* Mobile floating menu button (no fixed top/bottom bar) */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed start-3 top-3 z-30 rounded-full border border-border bg-card/90 p-2.5 text-foreground shadow-lg backdrop-blur-md lg:hidden"
        aria-label="القائمة"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile slide-in sidebar drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="إغلاق"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 start-0 flex w-[min(80%,18rem)] flex-col border-e border-border bg-sidebar shadow-xl">
            <div className="flex h-16 items-center justify-between border-b border-border/70 px-4">
              <Link href="/chat" className="flex items-center gap-2">
                <Image src="/logo.png" alt="AiChart" width={26} height={26} className="rounded-lg" />
                <span className="font-bold tracking-tight">AiChart</span>
              </Link>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-sidebar-accent"
                aria-label="إغلاق"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {navList(() => setMobileOpen(false))}
            <div className="border-t border-border/70 p-3">
              <p className="truncate px-2 pb-2 text-xs text-muted-foreground">{displayName}</p>
              <button
                type="button"
                onClick={() => void logout()}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              >
                <LogOut className="h-4 w-4" />
                خروج
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Content */}
      <div className="flex min-h-dvh flex-1 flex-col">
        <main
          className={cn(
            "flex-1",
            noPadding ? "min-h-0" : "px-4 pb-4 pt-14 sm:px-6 sm:pb-6 lg:pt-6",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
