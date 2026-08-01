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
import type { AppLocale } from "@/lib/i18n";

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

/**
 * Labels live here rather than in the shared i18n dictionaries because this
 * module is the single source of truth for admin destinations — a tab and its
 * two labels are added in one place, and the dictionaries stay owned by the
 * trader-facing surfaces.
 */
export interface AdminNavLabels {
  /** Arabic — the primary locale. */
  label: string;
  labelEn: string;
}

export interface AdminNavItem extends AdminNavLabels {
  id: AdminTabId;
  icon: AdminNavIcon;
  /** null → reachable by any signed-in admin. */
  permission: AdminPermission | null;
}

export interface AdminNavGroup extends AdminNavLabels {
  id: string;
  items: AdminNavItem[];
}

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    id: "home",
    label: "الرئيسية",
    labelEn: "Home",
    items: [
      {
        id: "overview",
        label: "نظرة عامة",
        labelEn: "Overview",
        icon: DashboardSquare01Icon,
        permission: "users_read",
      },
    ],
  },
  {
    id: "customers",
    label: "العملاء",
    labelEn: "Customers",
    items: [
      {
        id: "users",
        label: "المستخدمون",
        labelEn: "Users",
        icon: UserMultiple02Icon,
        permission: "users_read",
      },
      {
        id: "subscriptions",
        label: "الاشتراكات",
        labelEn: "Subscriptions",
        icon: CreditCardIcon,
        permission: "billing_read",
      },
      {
        id: "support",
        label: "الدعم",
        labelEn: "Support",
        icon: CustomerSupportIcon,
        permission: "tickets",
      },
    ],
  },
  {
    id: "money",
    label: "المال",
    labelEn: "Revenue",
    items: [
      {
        id: "billing",
        label: "الفوترة والأرباح",
        labelEn: "Billing and profit",
        icon: MoneyBag02Icon,
        permission: "profit_read",
      },
    ],
  },
  {
    id: "platform",
    label: "المنصة",
    labelEn: "Platform",
    items: [
      {
        id: "keys",
        label: "المفاتيح",
        labelEn: "Keys",
        icon: Key01Icon,
        permission: "keys_write",
      },
      {
        id: "system",
        label: "النظام",
        labelEn: "System",
        icon: ServerStack01Icon,
        permission: "keys_write",
      },
      {
        id: "diagnostics",
        label: "التشخيص",
        labelEn: "Diagnostics",
        icon: Stethoscope02Icon,
        permission: "keys_write",
      },
    ],
  },
  {
    id: "governance",
    label: "الحوكمة",
    labelEn: "Governance",
    items: [
      {
        id: "team",
        label: "المشرفون",
        labelEn: "Admins",
        icon: UserGroupIcon,
        permission: "roles_write",
      },
      {
        id: "security",
        label: "الأمن",
        labelEn: "Security",
        icon: Shield01Icon,
        permission: "keys_write",
      },
      {
        id: "usage",
        label: "الاستهلاك",
        labelEn: "Usage",
        icon: ChartHistogramIcon,
        permission: "keys_write",
      },
    ],
  },
];

/** Names the admin nav landmark and the platform header; one string, two homes. */
export const ADMIN_CONSOLE_TITLE: AdminNavLabels = {
  label: "لوحة المنصة",
  labelEn: "Platform console",
};

/** Lives in the sidebar footer, not in a group — it is the one non-admin surface. */
export const ADMIN_PROFILE_ITEM: AdminNavItem = {
  id: "profile",
  label: "الملف الشخصي",
  labelEn: "Profile",
  icon: UserAccountIcon,
  permission: null,
};

const ALL_ITEMS: AdminNavItem[] = [
  ...ADMIN_NAV_GROUPS.flatMap((group) => group.items),
  ADMIN_PROFILE_ITEM,
];

/** The deep link a tab id resolves to — the one place the query shape is spelled. */
export function adminTabHref(id: AdminTabId): string {
  return `/console/platform?tab=${id}`;
}

export function adminNavItem(id: AdminTabId): AdminNavItem {
  return ALL_ITEMS.find((item) => item.id === id) ?? ADMIN_PROFILE_ITEM;
}

/** Picks the label for the active locale; Arabic is the fallback. */
export function adminLabel(node: AdminNavLabels, locale: AppLocale): string {
  return locale === "en" ? node.labelEn : node.label;
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

/**
 * Groups a given admin may actually open, with empty groups dropped.
 *
 * An absent or empty permission list means "show everything", matching
 * navConfig's implicit-owner convention: the shell renders this list from
 * `/api/me`, and during that request there are no permissions yet — failing
 * closed there would blank the whole rail on every page load.
 */
export function adminGroupsFor(
  permissions?: readonly string[] | null,
): AdminNavGroup[] {
  if (!permissions?.length) return ADMIN_NAV_GROUPS;
  const granted = new Set(permissions);
  return ADMIN_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => item.permission === null || granted.has(item.permission),
    ),
  })).filter((group) => group.items.length > 0);
}

const ROLE_SIGNATURES: ReadonlyArray<
  AdminNavLabels & { permissions: AdminPermission[] }
> = [
  {
    label: "مالك",
    labelEn: "Owner",
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
  { label: "دعم", labelEn: "Support", permissions: ["users_read", "tickets"] },
  {
    label: "إدارة المستخدمين",
    labelEn: "User management",
    permissions: ["users_read", "users_write", "billing_read", "tickets"],
  },
  { label: "إدارة المحتوى", labelEn: "Content management", permissions: ["content_write"] },
  {
    label: "المالية",
    labelEn: "Finance",
    permissions: ["users_read", "billing_read", "billing_write", "profit_read"],
  },
];

function signature(permissions: readonly AdminPermission[]): string {
  return [...permissions].sort().join(",");
}

const ROLE_LABEL_BY_SIGNATURE = new Map(
  ROLE_SIGNATURES.map((role) => [signature(role.permissions), role]),
);

const NEUTRAL_ROLE: AdminNavLabels = { label: "مشرف", labelEn: "Admin" };

/**
 * Names the role the server actually granted. `@/lib/adminRoles` cannot be
 * imported as a value from a client module — it pulls `@/lib/db` in with it —
 * so the five role shapes are recognised by their permission set instead. A set
 * that matches none of them (a role added server-side later) degrades to the
 * neutral "مشرف" rather than inventing a name.
 */
export function adminRoleLabel(
  permissions: readonly AdminPermission[],
  locale: AppLocale = "ar",
): string {
  return adminLabel(
    ROLE_LABEL_BY_SIGNATURE.get(signature(permissions)) ?? NEUTRAL_ROLE,
    locale,
  );
}
