"use client";

import {
  ChartHistogramIcon,
  CreditCardIcon,
  CustomerSupportIcon,
  DashboardSquare01Icon,
  Key01Icon,
  MoneyBag02Icon,
  ServerStack01Icon,
  Shield01Icon,
  Stethoscope02Icon,
  UserAccountIcon,
  UserGroupIcon,
  UserMultiple02Icon,
} from "@hugeicons/core-free-icons";
import type { AdminPermission } from "@/lib/adminRoles";

/** hugeicons keeps `IconSvgObject` internal, so the type is taken from a real icon. */
export type AdminNavIcon = typeof DashboardSquare01Icon;

/**
 * Every id here is also a live deep link (`/console/platform?tab=<id>`) shipped
 * in navConfig.ts, four page-level redirects and BridgeOverviewClient. Renaming
 * one silently 404s a bookmark, so ids are append-only.
 */
export const ADMIN_TAB_IDS = [
  "overview",
  "users",
  "subscriptions",
  "support",
  "billing",
  "keys",
  "system",
  "diagnostics",
  "team",
  "security",
  "usage",
  "profile",
] as const;

export type AdminTabId = (typeof ADMIN_TAB_IDS)[number];

export interface AdminNavItem {
  id: AdminTabId;
  label: string;
  icon: AdminNavIcon;
  /** null → reachable by any signed-in admin. */
  permission: AdminPermission | null;
}

export interface AdminNavGroup {
  id: string;
  label: string;
  items: AdminNavItem[];
}

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    id: "home",
    label: "الرئيسية",
    items: [
      {
        id: "overview",
        label: "نظرة عامة",
        icon: DashboardSquare01Icon,
        permission: "users_read",
      },
    ],
  },
  {
    id: "customers",
    label: "العملاء",
    items: [
      {
        id: "users",
        label: "المستخدمون",
        icon: UserMultiple02Icon,
        permission: "users_read",
      },
      {
        id: "subscriptions",
        label: "الاشتراكات",
        icon: CreditCardIcon,
        permission: "billing_read",
      },
      {
        id: "support",
        label: "الدعم",
        icon: CustomerSupportIcon,
        permission: "tickets",
      },
    ],
  },
  {
    id: "money",
    label: "المال",
    items: [
      {
        id: "billing",
        label: "الفوترة والأرباح",
        icon: MoneyBag02Icon,
        permission: "profit_read",
      },
    ],
  },
  {
    id: "platform",
    label: "المنصة",
    items: [
      { id: "keys", label: "المفاتيح", icon: Key01Icon, permission: "keys_write" },
      {
        id: "system",
        label: "النظام",
        icon: ServerStack01Icon,
        permission: "keys_write",
      },
      {
        id: "diagnostics",
        label: "التشخيص",
        icon: Stethoscope02Icon,
        permission: "keys_write",
      },
    ],
  },
  {
    id: "governance",
    label: "الحوكمة",
    items: [
      {
        id: "team",
        label: "المشرفون",
        icon: UserGroupIcon,
        permission: "roles_write",
      },
      {
        id: "security",
        label: "الأمن",
        icon: Shield01Icon,
        permission: "keys_write",
      },
      {
        id: "usage",
        label: "الاستهلاك",
        icon: ChartHistogramIcon,
        permission: "keys_write",
      },
    ],
  },
];

/** Lives in the sidebar footer, not in a group — it is the one non-admin surface. */
export const ADMIN_PROFILE_ITEM: AdminNavItem = {
  id: "profile",
  label: "الملف الشخصي",
  icon: UserAccountIcon,
  permission: null,
};

const ALL_ITEMS: AdminNavItem[] = [
  ...ADMIN_NAV_GROUPS.flatMap((group) => group.items),
  ADMIN_PROFILE_ITEM,
];

export function adminNavItem(id: AdminTabId): AdminNavItem {
  return ALL_ITEMS.find((item) => item.id === id) ?? ADMIN_PROFILE_ITEM;
}

export function isAdminTabId(value: string | null | undefined): value is AdminTabId {
  return !!value && (ADMIN_TAB_IDS as readonly string[]).includes(value);
}

/**
 * An unknown or absent `?tab=` lands on the overview; every explicit id still
 * resolves to the panel it always resolved to. A non-admin can only ever be on
 * the profile tab, whatever the query string says.
 */
export function resolveAdminTab(
  raw: string | null | undefined,
  isAdmin: boolean,
): AdminTabId {
  if (!isAdmin) return "profile";
  return isAdminTabId(raw) ? raw : "overview";
}

/** Cosmetic gate only — the APIs behind each panel enforce with requireAdminWith. */
export function canOpenAdminTab(
  item: AdminNavItem,
  permissions: readonly AdminPermission[],
): boolean {
  return item.permission === null || permissions.includes(item.permission);
}

const ROLE_SIGNATURES: ReadonlyArray<{
  label: string;
  permissions: AdminPermission[];
}> = [
  {
    label: "مالك",
    permissions: [
      "users_read",
      "users_write",
      "billing_read",
      "billing_write",
      "profit_read",
      "content_write",
      "tickets",
      "keys_write",
      "roles_write",
    ],
  },
  { label: "دعم", permissions: ["users_read", "tickets"] },
  {
    label: "إدارة المستخدمين",
    permissions: ["users_read", "users_write", "billing_read", "tickets"],
  },
  { label: "إدارة المحتوى", permissions: ["content_write"] },
  {
    label: "المالية",
    permissions: ["users_read", "billing_read", "billing_write", "profit_read"],
  },
];

function signature(permissions: readonly AdminPermission[]): string {
  return [...permissions].sort().join(",");
}

const ROLE_LABEL_BY_SIGNATURE = new Map(
  ROLE_SIGNATURES.map((role) => [signature(role.permissions), role.label]),
);

/**
 * Names the role the server actually granted. `@/lib/adminRoles` cannot be
 * imported as a value from a client module — it pulls `@/lib/db` in with it —
 * so the five role shapes are recognised by their permission set instead. A set
 * that matches none of them (a role added server-side later) degrades to the
 * neutral "مشرف" rather than inventing a name.
 */
export function adminRoleLabel(permissions: readonly AdminPermission[]): string {
  return ROLE_LABEL_BY_SIGNATURE.get(signature(permissions)) ?? "مشرف";
}
