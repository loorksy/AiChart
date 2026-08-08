"use client";

/**
 * Shared tab bar for `/quant-agent` (plan §4) — "Feed" (the existing,
 * unchanged `QuantAgentFeedClient`) and "Chat" (new). Mounted once in
 * `quant-agent/layout.tsx` so both routes share it without either page
 * needing to know about the other.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ListChecks, MessageCircle } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/quant-agent", labelKey: "qa.tabs.feed", icon: ListChecks },
  { href: "/quant-agent/chat", labelKey: "qa.tabs.chat", icon: MessageCircle },
] as const;

export function QuantAgentTabs() {
  const { t, dir } = useLocale();
  const pathname = usePathname();

  return (
    <nav
      dir={dir}
      aria-label={t("qa.tabs.label")}
      className="mx-auto flex w-full max-w-6xl gap-1.5 overflow-x-auto pb-1"
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {t(tab.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
