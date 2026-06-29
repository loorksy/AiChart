import {
  Home,
  Link2,
  Plug,
  TrendingUp,
  User,
} from "lucide-react";

export const USER_NAV = [
  { href: "/console", label: "الرئيسية", icon: Home, exact: true },
  { href: "/console/mcp", label: "Claude MCP", icon: Plug },
  { href: "/console/connect", label: "الاتصالات", icon: Link2 },
  { href: "/console/trades", label: "صفقاتي", icon: TrendingUp },
  { href: "/console/account", label: "حسابي", icon: User },
] as const;
