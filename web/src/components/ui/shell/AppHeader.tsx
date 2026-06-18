"use client";

import Link from "next/link";
import { ChevronDown, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { NotificationPanel } from "./NotificationPanel";

export function AppHeader({
  onMenuClick,
  credits,
  creditsLoading,
  pendingIntents = 0,
  unreadAlerts = 0,
  onNotificationsRefresh,
  showMenu = true,
  className,
  center,
}: {
  onMenuClick?: () => void;
  credits?: number | null;
  creditsLoading?: boolean;
  pendingIntents?: number;
  unreadAlerts?: number;
  onNotificationsRefresh?: () => void;
  showMenu?: boolean;
  className?: string;
  center?: React.ReactNode;
}) {
  return (
    <header
      className={cn(
        "z-40 flex shrink-0 items-center justify-between gap-3 bg-background px-3 py-2.5 sm:px-4",
        "pt-[max(0.5rem,env(safe-area-inset-top))]",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {showMenu && onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            className="rounded-lg p-2 text-muted-foreground transition hover:bg-secondary md:hidden"
            aria-label="القائمة"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        {!center && (
          <Link
            href="/chat"
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold transition hover:bg-secondary"
          >
            <img src="/logo.png" alt="AiChart" className="h-5 w-5 shrink-0 object-contain rounded-md" />
            <span>AiChart</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </Link>
        )}
      </div>

      {center && <div className="min-w-0 flex-1 text-center">{center}</div>}

      <div className="flex shrink-0 items-center gap-1.5">
        <NotificationPanel
          pendingIntents={pendingIntents}
          unreadAlerts={unreadAlerts}
          onCountsChange={onNotificationsRefresh}
        />
        {creditsLoading ? (
          <span className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
            …
          </span>
        ) : credits != null ? (
          <Link
            href="/dashboard"
            className="hidden rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition hover:bg-secondary sm:inline-flex"
          >
            {credits} رصيد
          </Link>
        ) : null}
      </div>
    </header>
  );
}
