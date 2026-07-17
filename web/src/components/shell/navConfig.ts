import {
  Activity,
  BarChart3,
  Bot,
  CreditCard,
  KeyRound,
  Shield,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
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
 * Canonical primary navigation for active subscribers.
 * Chat History lives inside the sidebar conversation section, not as a page.
 * Account / Integrations / Settings live only in the profile popover.
 */
export const APP_NAV: NavItem[] = [
  { href: "/console", labelKey: "nav.workspace", icon: Bot, exact: true },
  { href: "/statistics", labelKey: "nav.statistics", icon: BarChart3 },
  { href: "/console/trades", labelKey: "nav.trades", icon: TrendingUp },
];

/**
 * Administrator destinations only — built from repository-confirmed admin surfaces.
 * Do not reuse trader Chart/Chat/Statistics/Trades here.
 */
export const ADMIN_NAV: NavItem[] = [
  { href: "/console", labelKey: "nav.admin_overview", icon: Activity, exact: true },
  { href: "/console/platform?tab=users", labelKey: "nav.admin_users", icon: Users },
  {
    href: "/console/platform?tab=subscriptions",
    labelKey: "nav.admin_subscriptions",
    icon: CreditCard,
  },
  { href: "/console/platform?tab=keys", labelKey: "nav.admin_keys", icon: KeyRound },
  { href: "/console/platform?tab=system", labelKey: "nav.admin_system", icon: Bot },
  { href: "/console/platform?tab=security", labelKey: "nav.admin_security", icon: Shield },
  { href: "/console/platform?tab=usage", labelKey: "nav.admin_usage", icon: BarChart3 },
];

export type AccessTier = "admin" | "full" | "trial" | "blocked";

/** Trial / blocked users only see the limited trial chat destination. */
export const TRIAL_NAV: NavItem[] = [
  { href: "/console", labelKey: "nav.workspace", icon: Bot, exact: true },
];

export function navForRole(role: NavRole, access: AccessTier = "full"): NavItem[] {
  if (role === "admin" || access === "admin") return ADMIN_NAV;
  if (access === "trial" || access === "blocked") return TRIAL_NAV;
  return APP_NAV;
}

export function activeNav(pathname: string, item: NavItem, currentTab?: string | null): boolean {
  if (item.exact) return pathname === item.href || (item.href === "/console" && pathname === "/console/");
  const baseHref = item.href.split("?")[0]!;
  const basePathname = pathname.split("?")[0]!;
  if (item.href.includes("?tab=")) {
    return basePathname === baseHref && currentTab === item.href.split("?tab=")[1];
  }
  return basePathname.startsWith(baseHref);
}
