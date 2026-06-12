"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  Cable,
  LogOut,
  Menu,
  MoreHorizontal,
  X,
} from "lucide-react";
import {
  BRIDGE_NAV_MORE,
  BRIDGE_NAV_PRIMARY,
  bridgeNavLabel,
} from "@/components/bridge/bridgeNav";
import { cn } from "@/lib/utils";

export default function BridgeShell({
  email,
  role,
  children,
}: {
  email: string;
  role: "user" | "admin";
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const isMoreActive = BRIDGE_NAV_MORE.some((n) => pathname.startsWith(n.href));

  const sidebarNav = (
    <nav className="flex flex-col gap-0.5 p-3">
      <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        مركز الجسر
      </p>
      {BRIDGE_NAV_PRIMARY.map((item) => {
        const active =
          "exact" in item && item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setDrawerOpen(false)}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition",
              active
                ? "bg-primary/15 font-semibold text-primary"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
      <div className="my-2 border-t border-border" />
      {BRIDGE_NAV_MORE.map((item) => {
        const active = pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setDrawerOpen(false)}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition",
              active
                ? "bg-primary/15 font-semibold text-primary"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 flex-col border-l border-border bg-sidebar md:flex">
        <div className="border-b border-border p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
              <Cable className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold">AiChart Bridge</p>
              <p className="text-[10px] text-muted-foreground">
                OpenClaw ↔ Binance / MT5
              </p>
            </div>
          </div>
        </div>
        {sidebarNav}
        <div className="mt-auto space-y-1 border-t border-border p-3">
          <p className="truncate px-3 text-[10px] text-muted-foreground" dir="ltr">
            {email}
            {role === "admin" && " · admin"}
          </p>
          <button
            type="button"
            onClick={() => void logout()}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground transition hover:bg-sidebar-accent hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" />
            خروج
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
        <header className="flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur-md md:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-lg p-2 text-muted-foreground hover:bg-secondary md:hidden"
              onClick={() => setDrawerOpen(true)}
              aria-label="القائمة"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <p className="text-xs text-muted-foreground md:hidden">AiChart Bridge</p>
              <h1 className="text-sm font-semibold md:text-base">
                {bridgeNavLabel(pathname)}
              </h1>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1200px] flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-background/95 backdrop-blur-md md:hidden">
        {BRIDGE_NAV_PRIMARY.map((item) => {
          const active =
            "exact" in item && item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px]",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={cn(
            "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px]",
            isMoreActive ? "text-primary" : "text-muted-foreground",
          )}
        >
          <MoreHorizontal className="h-5 w-5" />
          المزيد
        </button>
      </nav>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            onClick={() => setDrawerOpen(false)}
            aria-label="إغلاق"
          />
          <aside className="absolute right-0 top-0 flex h-full w-64 flex-col bg-sidebar shadow-xl">
            <div className="flex items-center justify-between border-b border-border p-4">
              <span className="font-bold">مركز الجسر</span>
              <button type="button" onClick={() => setDrawerOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            {sidebarNav}
            <div className="mt-auto border-t border-border p-3">
              <button
                type="button"
                onClick={() => void logout()}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground"
              >
                <LogOut className="h-3.5 w-3.5" />
                خروج
              </button>
            </div>
          </aside>
        </div>
      )}

      {moreOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            onClick={() => setMoreOpen(false)}
            aria-label="إغلاق"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border bg-background p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-semibold">المزيد</span>
              <button type="button" onClick={() => setMoreOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-1">
              {BRIDGE_NAV_MORE.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm hover:bg-secondary"
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
              <button
                type="button"
                onClick={() => void logout()}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm text-destructive hover:bg-destructive/10"
              >
                <LogOut className="h-4 w-4" />
                خروج
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
