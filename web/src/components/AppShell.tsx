"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  LogOut,
  MessageSquare,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AppHeader, MobileDrawer } from "@/components/ui/shell";
import { useMe } from "@/hooks/useMe";
import { useChatStore } from "@/stores/chat-store";
import { displayNameFromEmail } from "@/lib/displayName";

const MAIN_TABS = [
  { href: "/chat", label: "المحادثة", icon: MessageSquare },
  { href: "/dashboard", label: "اللوحة", icon: LayoutDashboard },
  { href: "/signals/new", label: "الإشارات", icon: TrendingUp },
] as const;

export default function AppShell({
  email,
  role,
  children,
  chatLayout = false,
  hideBottomNav = false,
  creditsRefreshKey = 0,
}: {
  email: string;
  role: "user" | "admin";
  children: React.ReactNode;
  chatLayout?: boolean;
  hideBottomNav?: boolean;
  creditsRefreshKey?: number;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { data: me, loading: meLoading } = useMe(creditsRefreshKey);
  const fetchConversations = useChatStore((s) => s.fetchConversations);

  const displayName = me?.displayName ?? displayNameFromEmail(email);
  const creditsRemaining = me?.quota.remaining ?? 0;
  const creditsLimit = me?.quota.limit ?? 0;

  useEffect(() => {
    if (drawerOpen || pathname.startsWith("/chat")) {
      void fetchConversations();
    }
  }, [drawerOpen, pathname, fetchConversations]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const showBottomNav = !chatLayout && !hideBottomNav;

  return (
    <div
      className={cn(
        "flex min-h-dvh flex-col bg-background",
        chatLayout && "h-dvh max-h-dvh overflow-hidden",
      )}
    >
      <AppHeader
        onMenuClick={() => setDrawerOpen(true)}
        credits={meLoading ? null : creditsRemaining}
        creditsLoading={meLoading}
      />

      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        email={email}
        displayName={displayName}
        creditsRemaining={creditsRemaining}
        creditsLimit={creditsLimit}
      />

      {/* Desktop top nav */}
      <nav className="hidden shrink-0 border-b border-border bg-card/50 px-6 md:flex">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-1 py-2">
          {MAIN_TABS.map((tab) => {
            const Icon = tab.icon;
            const active =
              pathname === tab.href ||
              (tab.href === "/signals/new" && pathname.startsWith("/signals"));
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </Link>
            );
          })}
          <div className="ms-auto flex items-center gap-2">
            <Link
              href="/settings"
              className="rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary"
            >
              الإعدادات
            </Link>
            {role === "admin" && (
              <Link
                href="/admin"
                className="rounded-full px-3 py-1.5 text-sm text-accent-gold hover:bg-secondary"
              >
                الأدمن
              </Link>
            )}
            <button
              onClick={() => void logout()}
              className="rounded-full p-2 text-muted-foreground hover:bg-secondary"
              aria-label="خروج"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </nav>

      <main
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          chatLayout && "overflow-hidden",
        )}
      >
        {children}
      </main>

      {showBottomNav && (
        <nav className="bottom-nav fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur-md md:hidden">
          <div className="flex items-stretch">
            {MAIN_TABS.map((tab) => {
              const Icon = tab.icon;
              const active =
                pathname === tab.href ||
                (tab.href === "/signals/new" && pathname.startsWith("/signals"));
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={cn(
                    "flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition",
                    active
                      ? "text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-5 w-5",
                      active && "text-accent-gold",
                    )}
                  />
                  {tab.label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
