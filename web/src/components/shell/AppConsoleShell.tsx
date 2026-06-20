"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut, PanelLeftClose, PanelLeft } from "lucide-react";
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
  const [collapsed, setCollapsed] = useState(false);
  const items = navForRole(role);
  const bottomItems = items.slice(0, 5);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

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

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
          {items.map((item) => {
            const active = activeNav(pathname, item);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                  collapsed && "justify-center px-0",
                  active
                    ? "bg-primary/15 font-semibold text-primary ring-1 ring-primary/20"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                )}
              >
                <Icon className="h-4.5 w-4.5 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

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

      {/* Content */}
      <div className="flex min-h-dvh flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur-md lg:hidden">
          <Link href="/console" className="flex items-center gap-2">
            <Image src="/logo.png" alt="AiChart" width={24} height={24} className="rounded-lg" />
            <span className="font-bold">AiChart</span>
          </Link>
          <button
            type="button"
            onClick={() => void logout()}
            className="text-muted-foreground"
            aria-label="خروج"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </header>

        <main
          className={cn(
            "flex-1",
            noPadding ? "min-h-0 pb-16 lg:pb-0" : "p-4 pb-24 sm:p-6 lg:pb-6",
          )}
        >
          {children}
        </main>

        {/* Mobile bottom nav */}
        <nav className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-border bg-background/95 px-1 py-1.5 backdrop-blur-md lg:hidden">
          {bottomItems.map((item) => {
            const active = activeNav(pathname, item);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] transition-colors",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
