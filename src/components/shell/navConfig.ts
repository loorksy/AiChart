import {
  Activity,
  BarChart3,
  Bot,
  CreditCard,
  KeyRound,
  LifeBuoy,
  NotebookPen,
  Shield,
  Stethoscope,
  Users,
  Wallet,
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
  { href: "/chat", labelKey: "nav.workspace", icon: Bot, exact: true },
  { href: "/recommendations", labelKey: "nav.recommendations", icon: NotebookPen },
  { href: "/performance", labelKey: "nav.performance", icon: BarChart3 },
];

export type AccessTier = "admin" | "full" | "trial" | "blocked";

/** Trial / blocked users only see the limited trial chat destination. */
export const TRIAL_NAV: NavItem[] = [
  { href: "/chat", labelKey: "nav.workspace", icon: Bot, exact: true },
];

/**
 * The product rail for a non-admin. Admins never read this: their rail is
 * built from `adminNavTree` (`adminGroupsFor`) inside AppConsoleShell — a
 * parallel ADMIN_NAV used to live here, computed for every admin render and
 * consumed by nothing, drifting quietly behind the real tree (it lacked the
 * support/billing/team tabs the rendered rail had). Two nav definitions for
 * one rail is how they disagree; now there is one.
 */
export function navForRole(
  role: NavRole,
  access: AccessTier = "full",
): NavItem[] {
  if (access === "trial" || access === "blocked") return TRIAL_NAV;
  return APP_NAV;
}

export function activeNav(pathname: string, item: NavItem, currentTab?: string | null): boolean {
  if (item.exact) return pathname === item.href || (item.href === "/chat" && pathname === "/chat/");
  const baseHref = item.href.split("?")[0]!;
  const basePathname = pathname.split("?")[0]!;
  if (item.href.includes("?tab=")) {
    return basePathname === baseHref && currentTab === item.href.split("?tab=")[1];
  }
  return basePathname.startsWith(baseHref);
}
