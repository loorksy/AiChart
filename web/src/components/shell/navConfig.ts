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
  { href: "/console", labelKey: "nav.workspace", icon: Bot, exact: true },
  // Recommendations + trades + statistics merged into one page: the plans,
  // their executions, and the numbers are one performance story, not three
  // routes. Old URLs redirect here with section anchors.
  { href: "/performance", labelKey: "nav.performance", icon: BarChart3 },
  { href: "/journal", labelKey: "nav.journal", icon: NotebookPen },
  // V2-A5: balance, statement, top-ups and subscription management.
  { href: "/console/billing", labelKey: "nav.billing", icon: Wallet },
  // V2-C: tickets — instant AI answer, human escalation on request.
  { href: "/console/support", labelKey: "nav.support", icon: LifeBuoy },
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
  {
    href: "/console/platform?tab=diagnostics",
    labelKey: "nav.admin_diagnostics",
    icon: Stethoscope,
  },
];

export type AccessTier = "admin" | "full" | "trial" | "blocked";

/** Trial / blocked users only see the limited trial chat destination. */
export const TRIAL_NAV: NavItem[] = [
  { href: "/console", labelKey: "nav.workspace", icon: Bot, exact: true },
];

/**
 * Which admin permission each ?tab= destination needs, mirroring the console's
 * own gate. Kept as a plain map so this leaf module never imports the DB-backed
 * adminRoles module into the client bundle.
 */
const ADMIN_NAV_PERMISSION: Record<string, string> = {
  users: "users_read",
  subscriptions: "billing_read",
  keys: "keys_write",
  system: "keys_write",
  security: "keys_write",
  usage: "keys_write",
  diagnostics: "keys_write",
};

export function navForRole(
  role: NavRole,
  access: AccessTier = "full",
  /**
   * Admin permissions of the signed-in user. Omitted (or empty) means "show
   * everything" — that is the implicit-owner case and today's single operator.
   * Passing a real list stops a scoped admin being offered destinations the
   * console will refuse, which read as dead links.
   */
  permissions?: readonly string[],
): NavItem[] {
  if (role === "admin" || access === "admin") {
    if (!permissions?.length) return ADMIN_NAV;
    return ADMIN_NAV.filter((item) => {
      const tab = item.href.split("?tab=")[1];
      const needed = tab ? ADMIN_NAV_PERMISSION[tab] : undefined;
      return !needed || permissions.includes(needed);
    });
  }
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
