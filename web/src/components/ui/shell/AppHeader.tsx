"use client";

import Link from "next/link";
import { Bell, Menu, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function AppHeader({
  onMenuClick,
  credits,
  creditsLoading,
  pendingIntents = 0,
  showMenu = true,
  className,
  center,
}: {
  onMenuClick?: () => void;
  credits?: number | null;
  creditsLoading?: boolean;
  pendingIntents?: number;
  showMenu?: boolean;
  className?: string;
  center?: React.ReactNode;
}) {
  return (
    <header
      className={cn(
        "z-40 flex shrink-0 items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur-md",
        "pt-[max(0.75rem,env(safe-area-inset-top))]",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {showMenu && onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            className="rounded-xl p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            aria-label="القائمة"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        {!center && (
          <Link href="/chat" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="font-serif text-base font-bold tracking-tight">
              Ai<span className="text-accent-gold">Chart</span>
            </span>
          </Link>
        )}
      </div>

      {center && <div className="min-w-0 flex-1 text-center">{center}</div>}

      <div className="flex shrink-0 items-center gap-2">
        {pendingIntents > 0 && (
          <Link
            href="/trades"
            className="relative rounded-full p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            aria-label={`${pendingIntents} صفقات بانتظار الموافقة`}
          >
            <Bell className="h-4 w-4" />
            <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {pendingIntents > 9 ? "9+" : pendingIntents}
            </span>
          </Link>
        )}
        {creditsLoading ? (
          <span className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
            …
          </span>
        ) : credits != null ? (
          <Link
            href="/dashboard"
            className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
          >
            {credits} رصيد
          </Link>
        ) : null}
      </div>
    </header>
  );
}
