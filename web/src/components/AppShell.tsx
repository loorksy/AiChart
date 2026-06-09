"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  LineChart,
  LogOut,
  MessageSquare,
  MessageSquarePlus,
  MessagesSquare,
  Settings,
  Shield,
  Sparkles,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ar } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { AppHeader, MobileDrawer } from "@/components/ui/shell";
import { useMe } from "@/hooks/useMe";
import { useChatStore } from "@/stores/chat-store";
import { displayNameFromEmail } from "@/lib/displayName";

const MAIN_TABS = [
  { href: "/chat", label: "المحادثة", icon: MessageSquare },
  { href: "/dashboard", label: "اللوحة", icon: LayoutDashboard },
  { href: "/market", label: "السوق", icon: LineChart },
  { href: "/signals/new", label: "الإشارات", icon: TrendingUp },
] as const;

function isTabActive(pathname: string, href: string): boolean {
  if (href === "/signals/new") return pathname.startsWith("/signals");
  return pathname === href || pathname.startsWith(`${href}/`);
}

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
  const conversations = useChatStore((s) => s.conversations);
  const selectedId = useChatStore((s) => s.selectedId);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const resetSelection = useChatStore((s) => s.resetSelection);
  const createNew = useChatStore((s) => s.createNew);

  const onChatPage = pathname.startsWith("/chat");

  const displayName = me?.displayName ?? displayNameFromEmail(email);
  const creditsRemaining = me?.quota.remaining ?? 0;
  const creditsLimit = me?.quota.limit ?? 0;
  const initials = displayName.slice(0, 2).toUpperCase();

  useEffect(() => {
    void fetchConversations();
  }, [drawerOpen, pathname, fetchConversations]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  async function handleNewChat() {
    resetSelection();
    await createNew();
  }

  const showBottomNav = !chatLayout && !hideBottomNav;

  return (
    <div
      className={cn(
        "min-h-dvh bg-background md:flex md:flex-row-reverse",
        chatLayout && "h-dvh max-h-dvh overflow-hidden",
      )}
    >
      {/* Desktop sidebar (right side in RTL) */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-s border-border bg-sidebar md:flex">
        <Link
          href="/chat"
          className="flex items-center gap-2 border-b border-border px-5 py-4"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="h-5 w-5" />
          </div>
          <span className="font-serif text-lg font-bold tracking-tight">
            Ai<span className="text-accent-gold">Chart</span>
          </span>
        </Link>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          <button
            type="button"
            onClick={() => void handleNewChat()}
            className="mb-2 flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-sm font-semibold transition hover:bg-secondary"
          >
            <MessageSquarePlus className="h-5 w-5 text-accent-gold" />
            محادثة جديدة
          </button>

          {MAIN_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = isTabActive(pathname, tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                  active
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                <Icon
                  className={cn("h-5 w-5", active && "text-accent-gold")}
                />
                {tab.label}
              </Link>
            );
          })}

          {/* Conversation history */}
          <div className="pt-3">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              المحادثات الأخيرة
            </p>
            {conversations.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                لا محادثات بعد
              </p>
            ) : (
              conversations.map((c) => {
                const active = selectedId === c.id && onChatPage;
                return (
                  <div
                    key={c.id}
                    className={cn(
                      "group flex items-center gap-1 rounded-xl transition",
                      active
                        ? "bg-secondary"
                        : "hover:bg-secondary/60",
                    )}
                  >
                    <Link
                      href="/chat"
                      onClick={() => void selectConversation(c.id)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-start"
                    >
                      <MessagesSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate text-sm">{c.title}</span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => void deleteConversation(c.id)}
                      className="me-1 shrink-0 rounded-lg p-1.5 text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100"
                      title="حذف"
                      aria-label="حذف المحادثة"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="my-3 border-t border-border" />

          <Link
            href="/settings"
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
              isTabActive(pathname, "/settings")
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            <Settings className="h-5 w-5" />
            الإعدادات
          </Link>
          {role === "admin" && (
            <Link
              href="/admin"
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                isTabActive(pathname, "/admin")
                  ? "bg-secondary text-foreground"
                  : "text-accent-gold hover:bg-secondary/60",
              )}
            >
              <Shield className="h-5 w-5" />
              لوحة الأدمن
            </Link>
          )}
        </nav>

        {/* Credits + user footer */}
        <div className="space-y-2 border-t border-border p-3">
          <Link
            href="/dashboard"
            className="block rounded-xl bg-secondary/60 px-3 py-2.5 transition hover:bg-secondary"
          >
            <p className="text-[11px] text-muted-foreground">الرصيد المتبقّي</p>
            <p className="font-serif text-xl font-bold">
              {meLoading ? "…" : creditsRemaining}
              <span className="ms-1 text-xs font-normal text-muted-foreground">
                / {creditsLimit}
              </span>
            </p>
          </Link>
          <div className="flex items-center gap-2 px-1">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{displayName}</p>
              <p
                className="truncate text-[10px] text-muted-foreground"
                dir="ltr"
              >
                {email}
              </p>
            </div>
            <button
              onClick={() => void logout()}
              className="rounded-lg p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              aria-label="خروج"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          chatLayout ? "h-dvh max-h-dvh overflow-hidden" : "min-h-dvh",
        )}
      >
        {/* Header — full on mobile, slim on desktop */}
        <div className="md:hidden">
          <AppHeader
            onMenuClick={() => setDrawerOpen(true)}
            credits={meLoading ? null : creditsRemaining}
            creditsLoading={meLoading}
            pendingIntents={me?.pendingIntents ?? 0}
          />
        </div>

        <MobileDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          email={email}
          displayName={displayName}
          creditsRemaining={creditsRemaining}
          creditsLimit={creditsLimit}
        />

        <main
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            chatLayout && "overflow-hidden",
            showBottomNav && "pb-16 md:pb-0",
          )}
        >
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      {showBottomNav && (
        <nav className="bottom-nav fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur-md md:hidden">
          <div className="flex items-stretch">
            {MAIN_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = isTabActive(pathname, tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={cn(
                    "flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <Icon
                    className={cn("h-5 w-5", active && "text-accent-gold")}
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
