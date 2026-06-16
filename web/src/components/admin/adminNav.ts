import {
  Cpu,
  KeyRound,
  LayoutDashboard,
  Lock,
  Server,
  Shield,
  Users,
} from "lucide-react";

export const ADMIN_NAV = [
  { href: "/admin", label: "نظرة عامة", icon: LayoutDashboard, exact: true },
  { href: "/admin/users", label: "المستخدمون", icon: Users },
  { href: "/admin/usage", label: "استهلاك Claude", icon: Cpu },
  { href: "/admin/limits", label: "حدود التداول", icon: Shield },
  { href: "/admin/keys", label: "المفاتيح", icon: KeyRound },
  { href: "/admin/system", label: "حالة النظام", icon: Server },
  { href: "/admin/security", label: "الأمن والتدقيق", icon: Lock },
] as const;

export const ADMIN_ACTION_LABELS: Record<string, string> = {
  injection_blocked: "حظر حقن برومبت",
  chat_agent: "محادثة وكيل",
  monitor_agent: "مراقبة تلقائية",
  trade_execute: "تنفيذ صفقة",
  kill_switch: "Kill Switch",
  settings_update: "تحديث إعدادات",
  telegram_register: "تسجيل عبر تليجرام",
  telegram_login: "دخول عبر تليجرام",
  user_access_granted: "موافقة وصول مستخدم",
  user_access_renewed: "تجديد صلاحية مستخدم",
  platform_config: "تحديث مفاتيح المنصة",
};
