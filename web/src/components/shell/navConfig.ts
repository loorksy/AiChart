import {
  CandlestickChart,
  History,
  KeyRound,
  LayoutDashboard,
  Link2,
  Plug,
  Settings,
  TrendingUp,
  Users,
  FileText,
  Cpu,
  Server,
  Lock,
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
  { href: "/chart", label: "الشارت", icon: CandlestickChart },
  { href: "/console", label: "نظرة", icon: LayoutDashboard, exact: true },
  { href: "/console/trades", label: "الصفقات", icon: TrendingUp },
  { href: "/console/recommendations", label: "سجل التوصيات", icon: History },
  { href: "/console/connect", label: "الاتصالات", icon: Link2 },
  { href: "/console/settings", label: "الإعدادات", icon: Settings },
  { href: "/console/mcp", label: "Claude MCP", icon: Plug },
  
  // Admin-only direct console routes
  { href: "/console/platform?tab=users", label: "المستخدمون", icon: Users, roles: ["admin"] },
  { href: "/console/pages", label: "إدارة الصفحات", icon: FileText, roles: ["admin"] },
  { href: "/console/platform?tab=usage", label: "استهلاك Claude", icon: Cpu, roles: ["admin"] },
  { href: "/console/platform?tab=keys", label: "المفاتيح", icon: KeyRound, roles: ["admin"] },
  { href: "/console/platform?tab=system", label: "حالة النظام", icon: Server, roles: ["admin"] },
  { href: "/console/platform?tab=security", label: "الأمن والتدقيق", icon: Lock, roles: ["admin"] },
];

export function navForRole(role: NavRole): NavItem[] {
  return APP_NAV.filter((i) => !i.roles || i.roles.includes(role));
}

export function activeNav(pathname: string, item: NavItem, currentTab?: string | null): boolean {
  if (item.exact) {
    return pathname === item.href;
  }
  
  const baseHref = item.href.split("?")[0];
  const basePathname = pathname.split("?")[0];
  
  if (item.href.includes("?tab=")) {
    const itemTab = item.href.split("?tab=")[1];
    return basePathname === baseHref && currentTab === itemTab;
  }
  
  return basePathname.startsWith(baseHref);
}
