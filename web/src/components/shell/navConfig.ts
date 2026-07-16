import { BarChart3, Bot, History, Link2, Settings, TrendingUp, UserRound, Users, type LucideIcon } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";

export type NavRole = "user" | "admin";

export interface NavItem {
  href: string;
  labelKey: TranslationKey;
  icon: LucideIcon;
  exact?: boolean;
  roles?: NavRole[];
}

/** Canonical daily-use navigation. Internal MCP/status and duplicate views stay hidden. */
export const APP_NAV: NavItem[] = [
  { href: "/console", labelKey: "nav.workspace", icon: Bot, exact: true },
  { href: "/console/recommendations", labelKey: "nav.recommendations", icon: History },
  { href: "/statistics", labelKey: "nav.statistics", icon: BarChart3 },
  { href: "/console/trades", labelKey: "nav.trades", icon: TrendingUp },
  { href: "/console/account", labelKey: "nav.account", icon: UserRound },
  { href: "/console/connect", labelKey: "nav.integrations", icon: Link2 },
  { href: "/console/settings", labelKey: "nav.settings", icon: Settings },
  { href: "/console/platform", labelKey: "nav.platform", icon: Users, roles: ["admin"] },
];

export function navForRole(role: NavRole): NavItem[] {
  return APP_NAV.filter((item) => !item.roles || item.roles.includes(role));
}

export function activeNav(pathname: string, item: NavItem, currentTab?: string | null): boolean {
  if (item.exact) return pathname === item.href;
  const baseHref = item.href.split("?")[0];
  const basePathname = pathname.split("?")[0];
  if (item.href.includes("?tab=")) {
    return basePathname === baseHref && currentTab === item.href.split("?tab=")[1];
  }
  return basePathname.startsWith(baseHref);
}
