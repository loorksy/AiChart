"use client";

import Link from "next/link";
import {
  ChevronDown,
  LayoutDashboard,
  LineChart,
  LogOut,
  MessageSquare,
  MessageSquarePlus,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Settings,
  Shield,
  Sparkles,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/lib/types";

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

export function ChatGptSidebar({
  pathname,
  role,
  collapsed,
  onToggleCollapse,
  onNewChat,
  conversations,
  selectedId,
  onChatPage,
  onSelectConversation,
  onDeleteConversation,
  displayName,
  email,
  initials,
  creditsRemaining,
  creditsLimit,
  creditsLoading,
  onLogout,
}: {
  pathname: string;
  role: "user" | "admin";
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNewChat: () => void;
  conversations: Conversation[];
  selectedId: number | null;
  onChatPage: boolean;
  onSelectConversation: (id: number) => void;
  onDeleteConversation: (id: number) => void;
  displayName: string;
  email: string;
  initials: string;
  creditsRemaining: number;
  creditsLimit: number;
  creditsLoading: boolean;
  onLogout: () => void;
}) {
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out md:flex",
        "border-s border-sidebar-border",
        collapsed ? "w-[3.25rem]" : "w-[17.5rem]",
      )}
    >
      {/* Top actions */}
      <div
        className={cn(
          "flex items-center gap-1 p-2",
          collapsed ? "flex-col" : "justify-between px-3 pt-3",
        )}
      >
        {!collapsed && (
          <Link
            href="/chat"
            className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 transition hover:bg-sidebar-accent"
          >
            <Sparkles className="h-5 w-5 shrink-0 text-foreground" />
            <span className="truncate text-sm font-semibold">AiChart</span>
          </Link>
        )}
        <div className={cn("flex items-center gap-0.5", collapsed && "flex-col")}>
          <button
            type="button"
            onClick={onToggleCollapse}
            className="rounded-lg p-2 text-muted-foreground transition hover:bg-sidebar-accent hover:text-foreground"
            aria-label={collapsed ? "توسيع القائمة" : "طي القائمة"}
            title={collapsed ? "توسيع" : "طي"}
          >
            {collapsed ? (
              <PanelRightOpen className="h-5 w-5" />
            ) : (
              <PanelRightClose className="h-5 w-5" />
            )}
          </button>
          {!collapsed && (
            <button
              type="button"
              className="rounded-lg p-2 text-muted-foreground transition hover:bg-sidebar-accent hover:text-foreground"
              aria-label="بحث"
              title="بحث (قريباً)"
            >
              <Search className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      <div className="px-2 pb-2">
        <button
          type="button"
          onClick={() => void onNewChat()}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg border border-sidebar-border text-sm font-medium transition hover:bg-sidebar-accent",
            collapsed ? "justify-center p-2.5" : "px-3 py-2.5",
          )}
          title="محادثة جديدة"
        >
          <MessageSquarePlus className="h-4 w-4 shrink-0" />
          {!collapsed && <span>محادثة جديدة</span>}
        </button>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2">
        {MAIN_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = isTabActive(pathname, tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              title={collapsed ? tab.label : undefined}
              data-active={active}
              className={cn(
                "sidebar-nav-item",
                collapsed && "justify-center px-2",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{tab.label}</span>}
            </Link>
          );
        })}

        {!collapsed && (
          <p className="px-3 pb-1 pt-4 text-xs font-medium text-muted-foreground">
            المحادثات الأخيرة
          </p>
        )}
        {conversations.length === 0 && !collapsed ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">لا محادثات بعد</p>
        ) : (
          conversations.map((c) => {
            const active = selectedId === c.id && onChatPage;
            return (
              <div
                key={c.id}
                className={cn(
                  "group flex items-center",
                  collapsed && "justify-center",
                )}
              >
                <Link
                  href="/chat"
                  onClick={() => void onSelectConversation(c.id)}
                  title={collapsed ? c.title : undefined}
                  data-active={active}
                  className={cn(
                    "sidebar-conv-item min-w-0 flex-1 truncate",
                    collapsed && "px-2 text-center",
                  )}
                >
                  {collapsed ? (
                    <MessageSquare className="mx-auto h-4 w-4" />
                  ) : (
                    c.title
                  )}
                </Link>
                {!collapsed && (
                  <button
                    type="button"
                    onClick={() => void onDeleteConversation(c.id)}
                    className="me-0.5 shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100"
                    title="حذف"
                    aria-label="حذف المحادثة"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })
        )}

        <div className="my-2 border-t border-sidebar-border" />

        <Link
          href="/settings"
          title={collapsed ? "الإعدادات" : undefined}
          data-active={isTabActive(pathname, "/settings")}
          className={cn(
            "sidebar-nav-item",
            collapsed && "justify-center px-2",
          )}
        >
          <Settings className="h-4 w-4 shrink-0" />
          {!collapsed && <span>الإعدادات</span>}
        </Link>
        {role === "admin" && (
          <Link
            href="/admin"
            title={collapsed ? "لوحة الأدمن" : undefined}
            data-active={isTabActive(pathname, "/admin")}
            className={cn(
              "sidebar-nav-item text-accent-gold",
              collapsed && "justify-center px-2",
            )}
          >
            <Shield className="h-4 w-4 shrink-0" />
            {!collapsed && <span>لوحة الأدمن</span>}
          </Link>
        )}
      </nav>

      {/* User footer */}
      <div className="border-t border-sidebar-border p-2">
        {!collapsed && (
          <Link
            href="/dashboard"
            className="mb-2 block rounded-lg px-3 py-2 transition hover:bg-sidebar-accent"
          >
            <p className="text-[10px] text-muted-foreground">الرصيد</p>
            <p className="text-sm font-semibold">
              {creditsLoading ? "…" : creditsRemaining}
              <span className="ms-1 text-xs font-normal text-muted-foreground">
                / {creditsLimit}
              </span>
            </p>
          </Link>
        )}
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg p-1.5 transition hover:bg-sidebar-accent",
            collapsed && "justify-center",
          )}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold">
            {initials}
          </div>
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{displayName}</p>
                <p className="flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                  <span>مجاني</span>
                  <ChevronDown className="h-3 w-3" />
                </p>
              </div>
              <button
                type="button"
                onClick={() => void onLogout()}
                className="rounded-lg p-2 text-muted-foreground transition hover:text-foreground"
                aria-label="خروج"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
        {!collapsed && (
          <p className="mt-1 truncate px-2 text-[10px] text-muted-foreground" dir="ltr">
            {email}
          </p>
        )}
      </div>
    </aside>
  );
}
