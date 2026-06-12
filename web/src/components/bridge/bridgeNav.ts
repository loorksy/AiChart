import {
  KeyRound,
  LayoutDashboard,
  Link2,
  MoreHorizontal,
  Shield,
  TrendingUp,
} from "lucide-react";

export const BRIDGE_NAV_PRIMARY = [
  { href: "/console", label: "نظرة", icon: LayoutDashboard, exact: true },
  { href: "/console/trades", label: "صفقات", icon: TrendingUp },
  { href: "/console/connect", label: "اتصال", icon: Link2 },
  { href: "/console/risk", label: "مخاطر", icon: Shield },
] as const;

export const BRIDGE_NAV_MORE = [
  { href: "/console/platform", label: "المنصة", icon: KeyRound },
] as const;

export const BRIDGE_NAV_SECONDARY = [
  { href: "/console/risk#kill", label: "Kill Switch", icon: Shield },
  { href: "/console/platform?tab=system", label: "OpenClaw", icon: KeyRound },
  { href: "/console/platform?tab=security", label: "سجل التدقيق", icon: KeyRound },
] as const;

export function bridgeNavLabel(pathname: string): string {
  const all = [...BRIDGE_NAV_PRIMARY, ...BRIDGE_NAV_MORE];
  const hit = all.find((n) =>
    "exact" in n && n.exact
      ? pathname === n.href
      : pathname.startsWith(n.href),
  );
  return hit?.label ?? "مركز الجسر";
}
