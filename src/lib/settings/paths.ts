import type { TranslationKey } from "@/lib/i18n";

/**
 * Canonical settings URLs. Each section is its own path so a bookmark, a
 * share, and the in-page nav all name the same place.
 *
 * Tab ids stay the older internal names (`profile`, `integrations`) so the
 * modal and saved query-string links keep working; the public slug is what
 * appears in the address bar.
 */
export const SETTINGS_ROOT = "/console/settings" as const;

export const SETTINGS_SECTIONS = [
  { id: "profile", slug: "account", labelKey: "settings.tab.account" },
  { id: "alerts", slug: "alerts", labelKey: "settings.tab.alerts" },
  { id: "appearance", slug: "appearance", labelKey: "settings.tab.appearance" },
  { id: "integrations", slug: "connections", labelKey: "settings.tab.connections" },
  { id: "skills", slug: "skills", labelKey: "skills.title" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];
export type SettingsSectionSlug = (typeof SETTINGS_SECTIONS)[number]["slug"];

const SLUGS = new Set<string>(SETTINGS_SECTIONS.map((s) => s.slug));

export function isSettingsSectionSlug(value: string): value is SettingsSectionSlug {
  return SLUGS.has(value);
}

export function settingsPath(id: SettingsSectionId): string {
  const section = SETTINGS_SECTIONS.find((item) => item.id === id);
  return `${SETTINGS_ROOT}/${section?.slug ?? "account"}`;
}

export function settingsTabFromSlug(slug: string): SettingsSectionId | null {
  return SETTINGS_SECTIONS.find((item) => item.slug === slug)?.id ?? null;
}

export function settingsTabFromLegacyQuery(tab: string | undefined): SettingsSectionId | null {
  if (!tab) return null;
  if (tab === "subscription") return "profile";
  if (SETTINGS_SECTIONS.some((item) => item.id === tab)) {
    return tab as SettingsSectionId;
  }
  if (isSettingsSectionSlug(tab)) return settingsTabFromSlug(tab);
  return null;
}

export function settingsLabelKey(id: SettingsSectionId): TranslationKey {
  return SETTINGS_SECTIONS.find((item) => item.id === id)?.labelKey ?? "settings.tab.account";
}
