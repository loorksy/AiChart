import {
  KeyRound,
  LayoutDashboard,
  Link2,
  LineChart,
  MessageSquare,
  Plug,
  Settings,
  Shield,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

export type NavRole = "user" | "admin";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  /** Roles allowed to see this item. Undefined = visible to all. */
  roles?: NavRole[];
}

/**
 * Single source of truth for the console/chat sidebar. Replaces the duplicated
 * USER_NAV / BRIDGE_NAV / ChatGptSidebar tabs. Filtered by role at render time.
 */
export const APP_NAV: NavItem[] = [
  { href: "/console", label: "نظرة", icon: LayoutDashboard, exact: true },
  { href: "/chat", label: "المحادثة", icon: MessageSquare },
  { href: "/console/trades", label: "الصفقات", icon: TrendingUp },
  { href: "/market", label: "السوق", icon: LineChart },
  { href: "/console/connect", label: "الاتصالات", icon: Link2 },
  { href: "/console/settings", label: "الإعدادات", icon: Settings },
  { href: "/console/mcp", label: "Claude MCP", icon: Plug },
  { href: "/console/risk", label: "المخاطر", icon: Shield, roles: ["admin"] },
  { href: "/console/platform", label: "المنصة", icon: KeyRound, roles: ["admin"] },
];

export function navForRole(role: NavRole): NavItem[] {
  return APP_NAV.filter((i) => !i.roles || i.roles.includes(role));
}

export function activeNav(pathname: string, item: NavItem): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}
