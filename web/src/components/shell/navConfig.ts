import { BarChart3, Bot, TrendingUp, Users, type LucideIcon } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";

export type NavRole = "user" | "admin";

export interface NavItem {
  href: string;
  labelKey: TranslationKey;
  icon: LucideIcon;
  exact?: boolean;
  roles?: NavRole[];
}

/**
 * Canonical primary navigation — Chart/Chat, Statistics, Trades (+ admin).
 * Chat History lives inside the sidebar conversation section, not as a page.
 * Account / Integrations / Settings live only in the profile popover.
 */
export const APP_NAV: NavItem[] = [
  { href: "/console", labelKey: "nav.workspace", icon: Bot, exact: true },
  { href: "/statistics", labelKey: "nav.statistics", icon: BarChart3 },
  { href: "/console/trades", labelKey: "nav.trades", icon: TrendingUp },
  { href: "/console/platform", labelKey: "nav.platform", icon: Users, roles: ["admin"] },
];

export function navForRole(role: NavRole): NavItem[] {
  return APP_NAV.filter((item) => !item.roles || item.roles.includes(role));
}

export function activeNav(pathname: string, item: NavItem, currentTab?: string | null): boolean {
  if (item.exact) return pathname === item.href;
  const baseHref = item.href.split("?")[0]!;
  const basePathname = pathname.split("?")[0]!;
  if (item.href.includes("?tab=")) {
    return basePathname === baseHref && currentTab === item.href.split("?tab=")[1];
  }
  return basePathname.startsWith(baseHref);
}
