"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { AppHeader, ChatGptSidebar, MobileDrawer } from "@/components/ui/shell";
import { useMe } from "@/hooks/useMe";
import { useChatStore } from "@/stores/chat-store";
import { displayNameFromEmail } from "@/lib/displayName";

export default function AppShell({
  email,
  role,
  children,
  chatLayout = false,
  creditsRefreshKey = 0,
}: {
  email: string;
  role: "user" | "admin";
  children: React.ReactNode;
  chatLayout?: boolean;
  creditsRefreshKey?: number;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { data: me, loading: meLoading, refresh: refreshMe } =
    useMe(creditsRefreshKey);
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

  return (
    <div
      className={cn(
        "min-h-dvh bg-background md:flex",
        chatLayout && "h-dvh max-h-dvh overflow-hidden",
      )}
    >
      {/* القائمة الجانبية — يمين الشاشة في RTL */}
      <ChatGptSidebar
        pathname={pathname}
        role={role}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        onNewChat={() => void handleNewChat()}
        conversations={conversations}
        selectedId={selectedId}
        onChatPage={onChatPage}
        onSelectConversation={(id) => void selectConversation(id)}
        onDeleteConversation={(id) => void deleteConversation(id)}
        displayName={displayName}
        email={email}
        initials={initials}
        creditsRemaining={creditsRemaining}
        creditsLimit={creditsLimit}
        creditsLoading={meLoading}
        onLogout={() => void logout()}
      />

      {/* المحتوى الرئيسي */}
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          chatLayout ? "h-dvh max-h-dvh overflow-hidden" : "min-h-dvh",
        )}
      >
        <AppHeader
          onMenuClick={() => setDrawerOpen(true)}
          credits={meLoading ? null : creditsRemaining}
          creditsLoading={meLoading}
          pendingIntents={me?.pendingIntents ?? 0}
          unreadAlerts={me?.unreadAlerts ?? 0}
          onNotificationsRefresh={() => void refreshMe()}
          className={cn(
            "border-b border-border/40 md:border-border/30",
            chatLayout && "md:py-2",
          )}
        />

        <MobileDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          email={email}
          displayName={displayName}
          role={role}
          creditsRemaining={creditsRemaining}
          creditsLimit={creditsLimit}
          creditsLoading={meLoading}
          onNewChat={() => void handleNewChat()}
          onLogout={() => void logout()}
        />

        <main
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            chatLayout && "overflow-hidden",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
