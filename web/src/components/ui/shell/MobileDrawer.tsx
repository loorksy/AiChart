"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Archive,
  CreditCard,
  FileText,
  LayoutDashboard,
  LineChart,
  MessageSquare,
  MessageSquarePlus,
  MessagesSquare,
  Settings,
  Sparkles,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ar } from "date-fns/locale";
import { useChatStore } from "@/stores/chat-store";
import { cn } from "@/lib/utils";
import { SurfaceCard } from "./SurfaceCard";

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

const SECONDARY_LINKS = [
  { href: "/reports", label: "التقارير", icon: FileText },
  { href: "/plan", label: "الخطة", icon: CreditCard },
  { href: "/settings", label: "الإعدادات", icon: Settings },
] as const;

export function MobileDrawer({
  open,
  onClose,
  email,
  displayName,
  creditsRemaining,
  creditsLimit,
  onNewChat,
}: {
  open: boolean;
  onClose: () => void;
  email: string;
  displayName: string;
  creditsRemaining: number;
  creditsLimit: number;
  onNewChat?: () => void;
}) {
  const pathname = usePathname();
  const {
    conversations,
    selectedId,
    selectConversation,
    deleteConversation,
    archiveConversation,
    resetSelection,
    createNew,
  } = useChatStore();

  if (!open) return null;

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

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        aria-label="إغلاق"
        onClick={onClose}
      />
      <aside className="absolute inset-y-0 end-0 flex w-[min(100%,20rem)] flex-col border-s border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <Link
            href="/chat"
            onClick={onClose}
            className="flex items-center gap-2"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="font-serif font-bold">AiChart</span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground hover:bg-secondary"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-1 border-b border-border p-2">
          {MAIN_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = isTabActive(pathname, tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                onClick={onClose}
                className={cn(
                  "flex flex-1 flex-col items-center gap-0.5 rounded-xl py-2 text-[10px] font-medium transition",
                  active
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60",
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </Link>
            );
          })}
        </div>

        <div className="flex gap-2 border-b border-border px-3 py-2">
          <button
            type="button"
            onClick={() => void handleNewChat()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-xs font-semibold text-primary-foreground"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            محادثة جديدة
          </button>
          {SECONDARY_LINKS.map((link) => {
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={onClose}
                className="flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-secondary"
              >
                <Icon className="h-3.5 w-3.5" />
                {link.label}
              </Link>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            المحادثات
          </p>
          {conversations.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              لا محادثات بعد
            </p>
          ) : (
            conversations.map((c) => {
              const active = selectedId === c.id;
              return (
                <div
                  key={c.id}
                  className={cn(
                    "group mb-1 flex items-center gap-1 rounded-xl",
                    active && "bg-secondary",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => void handleSelect(c.id)}
                    className="flex min-w-0 flex-1 items-start gap-2 px-2 py-2.5 text-start"
                  >
                    <MessagesSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{c.title}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(c.updated_at), {
                          addSuffix: true,
                          locale: ar,
                        })}
                      </p>
                    </div>
                  </button>
                  <div className="flex shrink-0 pe-1">
                    <button
                      type="button"
                      onClick={() => void archiveConversation(c.id)}
                      className="rounded p-1.5 text-muted-foreground hover:text-foreground"
                      title="أرشفة"
                    >
                      <Archive className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteConversation(c.id)}
                      className="rounded p-1.5 text-muted-foreground hover:text-destructive"
                      title="حذف"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="space-y-2 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <SurfaceCard padding="sm" className="bg-secondary/50">
            <p className="text-xs text-muted-foreground">الرصيد المتبقّي</p>
            <p className="font-serif text-2xl font-bold">
              {creditsRemaining}
              <span className="ms-1 text-sm font-normal text-muted-foreground">
                / {creditsLimit}
              </span>
            </p>
          </SurfaceCard>
          <div className="flex items-center gap-2 rounded-xl bg-secondary px-3 py-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{displayName}</p>
              <p className="truncate text-[10px] text-muted-foreground" dir="ltr">
                {email}
              </p>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
