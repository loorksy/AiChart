"use client";

/**
 * Shared tab bar for `/quant-agent` (plan §4) — "Feed" (the existing,
 * unchanged `QuantAgentFeedClient`), "Chat", "Analysis" (the LLM
 * trading-analysis surface), "Signals" (the persistent log of what the
 * scheduled monitors have actually fired) and "Bots" (the SIMULATION-ONLY
 * automated bot workbench — nothing there places an order). Mounted once in
 * `quant-agent/layout.tsx` so the routes share it without any page needing to
 * know about the others.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Bot, ListChecks, MessageCircle, Radar } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/quant-agent", labelKey: "qa.tabs.feed", icon: ListChecks },
  { href: "/quant-agent/chat", labelKey: "qa.tabs.chat", icon: MessageCircle },
  { href: "/quant-agent/analysis", labelKey: "qa.tabs.analysis", icon: Radar },
  { href: "/quant-agent/signals", labelKey: "qa.tabs.signals", icon: Bell },
  { href: "/quant-agent/bots", labelKey: "qa.tabs.bots", icon: Bot },
] as const;

/**
 * Exact match for the index tab (otherwise it would own every route below it),
 * prefix match for the rest so a sub-route like `/quant-agent/analysis/history`
 * still highlights the section it belongs to.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/quant-agent") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

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
        const active = isActive(pathname, tab.href);
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
