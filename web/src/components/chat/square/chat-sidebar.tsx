"use client";

import {
  MessageSquarePlus,
  Trash2,
  Archive,
  MessagesSquare,
  X,
} from "lucide-react";
import { useChatStore } from "@/stores/chat-store";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ar } from "date-fns/locale";

interface ChatSidebarProps {
  /** Drawer open state (collapsed by default). */
  open?: boolean;
  onClose?: () => void;
}

export function ChatSidebar({ open, onClose }: ChatSidebarProps) {
  const {
    conversations,
    selectedId,
    selectConversation,
    createNew,
    deleteConversation,
    archiveConversation,
    resetSelection,
  } = useChatStore();

  async function handleSelect(slug: string) {
    await selectConversation(slug);
    onClose?.();
  }

  async function handleNew() {
    resetSelection();
    await createNew();
    onClose?.();
  }

  const list = (
    <>
      <div className="flex items-center justify-between border-b border-border px-3 py-3">
        <span className="text-sm font-semibold text-foreground">المحادثات</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleNew()}
            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            title="محادثة جديدة"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-muted-foreground"
              aria-label="إغلاق"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {conversations.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            لا محادثات بعد. ابدأ سؤالاً جديداً.
          </p>
        ) : (
          conversations.map((c) => {
            const active = selectedId === c.id;
            return (
              <div
                key={c.id}
                className={cn(
                  "group mb-1 flex items-center gap-1 rounded-lg border border-transparent",
                  active && "border-primary/30 bg-primary/10",
                )}
              >
                <button
                  type="button"
                  onClick={() => void handleSelect(c.public_id)}
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
                <div className="flex shrink-0 opacity-100 md:opacity-0 md:transition md:group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => void archiveConversation(c.public_id)}
                    className="rounded p-1.5 text-muted-foreground hover:text-foreground"
                    title="أرشفة"
                  >
                    <Archive className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteConversation(c.public_id)}
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
    </>
  );

  // Collapsed-by-default slide-in drawer (all screen sizes).
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label="إغلاق"
        onClick={onClose}
      />
      <aside className="absolute inset-y-0 end-0 flex w-[min(100%,20rem)] flex-col border-s border-border bg-card shadow-xl">
        {list}
      </aside>
    </div>
  );
}
