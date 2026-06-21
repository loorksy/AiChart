"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, PanelLeftClose, PanelLeft, Menu, X, ChevronRight } from "lucide-react";
import { navForRole, activeNav, type NavRole } from "@/components/shell/navConfig";
import { cn } from "@/lib/utils";

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
              "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 cursor-pointer",
              collapsed && !onNavigate && "justify-center px-0",
              active
                ? "console-nav-active bg-green-500/10 text-green-400"
                : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200",
            )}
          >
            <Icon
              className={cn(
                "shrink-0 transition-colors",
                collapsed && !onNavigate ? "h-5 w-5" : "h-4 w-4",
                active ? "text-green-400" : "text-zinc-600 group-hover:text-zinc-300",
              )}
            />
            {(!collapsed || onNavigate) && (
              <span className="truncate">{item.label}</span>
            )}
            {active && !collapsed && (
              <ChevronRight className="ms-auto h-3.5 w-3.5 text-green-400/60 shrink-0" />
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
        "flex h-14 items-center border-b border-white/[0.05] px-3",
        collapsed ? "justify-center" : "justify-between",
      )}
    >
      {!collapsed && (
        <Link href="/console" className="flex items-center gap-2.5 group">
          <div className="relative">
            <Image
              src="/logo.png"
              alt="AiChart"
              width={28}
              height={28}
              className="rounded-lg ring-1 ring-white/10 group-hover:ring-green-500/30 transition-all"
            />
            <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-500 ring-1 ring-background" />
          </div>
          <span className="font-bold tracking-tight text-foreground">AiChart</span>
        </Link>
      )}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="rounded-lg p-1.5 text-zinc-500 transition-all hover:bg-white/[0.06] hover:text-zinc-200"
        aria-label={collapsed ? "توسيع القائمة" : "طيّ القائمة"}
      >
        {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
      </button>
    </div>
  );

  /* ─── Sidebar footer (user + logout) ─── */
  const sidebarFooter = (
    <div className="border-t border-white/[0.05] p-3 space-y-1">
      {!collapsed && (
        <div className="px-3 pb-2 flex items-center gap-2">
          <div className="h-6 w-6 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
            <span className="text-[10px] font-bold text-green-400">
              {displayName.charAt(0).toUpperCase()}
            </span>
          </div>
          <p className="truncate text-xs text-zinc-500 font-medium">{displayName}</p>
        </div>
      )}
      <button
        type="button"
        onClick={() => void logout()}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-zinc-600 transition-all hover:bg-red-500/10 hover:text-red-400 cursor-pointer",
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
    <div className="flex min-h-dvh flex-col bg-background lg:flex-row">
      {/* ─── Desktop sidebar ─── */}
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col border-e border-white/[0.05] bg-[#080809] transition-[width] duration-200 ease-in-out lg:flex",
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
        className="fixed start-3 top-3 z-30 rounded-xl border border-white/[0.08] bg-[#080809]/90 p-2.5 text-zinc-300 shadow-lg backdrop-blur-md lg:hidden cursor-pointer"
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
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            aria-label="إغلاق"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 start-0 flex w-[min(80%,18rem)] flex-col border-e border-white/[0.05] bg-[#080809] shadow-2xl">
            <div className="flex h-14 items-center justify-between border-b border-white/[0.05] px-4">
              <Link href="/console" className="flex items-center gap-2.5">
                <Image src="/logo.png" alt="AiChart" width={26} height={26} className="rounded-lg" />
                <span className="font-bold tracking-tight">AiChart</span>
              </Link>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200 cursor-pointer"
                aria-label="إغلاق"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {navList(() => setMobileOpen(false))}
            <div className="border-t border-white/[0.05] p-3 space-y-1">
              <div className="px-3 pb-2 flex items-center gap-2">
                <div className="h-6 w-6 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-bold text-green-400">
                    {displayName.charAt(0).toUpperCase()}
                  </span>
                </div>
                <p className="truncate text-xs text-zinc-500 font-medium">{displayName}</p>
              </div>
              <button
                type="button"
                onClick={() => void logout()}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-zinc-600 hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
                خروج
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* ─── Page content ─── */}
      <div className="flex min-h-dvh flex-1 flex-col">
        <main
          className={cn(
            "flex-1",
            noPadding ? "min-h-0" : "px-4 pb-6 pt-14 sm:px-6 sm:pb-8 lg:pt-6",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
