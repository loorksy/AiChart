"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  ChevronDown,
  LayoutDashboard,
  LineChart,
  LogOut,
  MessageSquare,
  MessageSquarePlus,
  PanelRightClose,
  Settings,
  Shield,
  Sparkles,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { useChatStore } from "@/stores/chat-store";
import { cn } from "@/lib/utils";

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

export function MobileDrawer({
  open,
  onClose,
  email,
  displayName,
  role,
  creditsRemaining,
  creditsLimit,
  creditsLoading,
  onNewChat,
  onLogout,
}: {
  open: boolean;
  onClose: () => void;
  email: string;
  displayName: string;
  role: "user" | "admin";
  creditsRemaining: number;
  creditsLimit: number;
  creditsLoading?: boolean;
  onNewChat?: () => void;
  onLogout?: () => void;
}) {
  const pathname = usePathname();
  const onChatPage = pathname.startsWith("/chat");
  const {
    conversations,
    selectedId,
    selectConversation,
    deleteConversation,
    resetSelection,
    createNew,
  } = useChatStore();

  async function handleNewChat() {
    resetSelection();
    await createNew();
    onNewChat?.();
    onClose();
  }

  async function handleSelect(id: number) {
    await selectConversation(id);
    onClose();
  }

  const initials = displayName.slice(0, 2).toUpperCase();

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 md:hidden",
        !open && "pointer-events-none",
      )}
      aria-hidden={!open}
    >
      <button
        type="button"
        className={cn(
          "absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ease-out motion-reduce:transition-none",
          open ? "opacity-100" : "opacity-0",
        )}
        aria-label="إغلاق"
        onClick={onClose}
        tabIndex={open ? 0 : -1}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="القائمة الجانبية"
        className={cn(
          "absolute inset-y-0 start-0 flex w-[min(100%,17.5rem)] flex-col overscroll-contain border-e border-sidebar-border bg-sidebar text-sidebar-foreground shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-3 pt-3">
          <Link
            href="/chat"
            onClick={onClose}
            className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 transition hover:bg-sidebar-accent"
          >
            <Sparkles className="h-5 w-5 shrink-0 text-foreground" />
            <span className="truncate text-sm font-semibold">AiChart</span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-muted-foreground transition hover:bg-sidebar-accent hover:text-foreground"
            aria-label="إغلاق القائمة"
            title="طي"
          >
            <PanelRightClose className="h-5 w-5" />
          </button>
        </div>

        <div className="px-2 pb-2">
          <button
            type="button"
            onClick={() => void handleNewChat()}
            className="flex h-11 min-h-[44px] w-full items-center gap-2 rounded-lg border border-sidebar-border px-3 text-sm font-medium transition hover:bg-sidebar-accent"
          >
            <MessageSquarePlus className="h-4 w-4 shrink-0" />
            محادثة جديدة
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
                onClick={onClose}
                data-active={active}
                className="sidebar-nav-item"
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{tab.label}</span>
              </Link>
            );
          })}

          <p className="px-3 pb-1 pt-4 text-xs font-medium text-muted-foreground">
            المحادثات الأخيرة
          </p>
          {conversations.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">لا محادثات بعد</p>
          ) : (
            conversations.map((c) => {
              const active = selectedId === c.id && onChatPage;
              return (
                <div key={c.id} className="group flex items-center">
                  <Link
                    href="/chat"
                    onClick={() => void handleSelect(c.id)}
                    data-active={active}
                    className="sidebar-conv-item min-w-0 flex-1 truncate"
                  >
                    {c.title}
                  </Link>
                  <button
                    type="button"
                    onClick={() => void deleteConversation(c.id)}
                    className="me-0.5 shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100"
                    title="حذف"
                    aria-label="حذف المحادثة"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })
          )}

          <div className="my-2 border-t border-sidebar-border" />

          <Link
            href="/settings"
            onClick={onClose}
            data-active={isTabActive(pathname, "/settings")}
            className="sidebar-nav-item"
          >
            <Settings className="h-4 w-4 shrink-0" />
            <span>الإعدادات</span>
          </Link>
          {role === "admin" && (
            <Link
              href="/admin"
              onClick={onClose}
              data-active={isTabActive(pathname, "/admin")}
              className="sidebar-nav-item text-accent-gold"
            >
              <Shield className="h-4 w-4 shrink-0" />
              <span>لوحة الأدمن</span>
            </Link>
          )}
        </nav>

        <div className="border-t border-sidebar-border p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <Link
            href="/dashboard"
            onClick={onClose}
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
          <div className="flex items-center gap-2 rounded-lg p-1.5 transition hover:bg-sidebar-accent">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{displayName}</p>
              <p className="flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                <span>مجاني</span>
                <ChevronDown className="h-3 w-3" />
              </p>
            </div>
            {onLogout && (
              <button
                type="button"
                onClick={() => void onLogout()}
                className="inline-flex h-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-muted-foreground transition hover:text-foreground"
                aria-label="خروج"
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="mt-1 truncate px-2 text-[10px] text-muted-foreground" dir="ltr">
            {email}
          </p>
        </div>
      </aside>
    </div>
  );
}
