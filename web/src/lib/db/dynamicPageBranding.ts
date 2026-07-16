import { BRAND_DOMAIN, BRAND_NAME, BRAND_URL } from "../brand";

export const LEGACY_SEEDED_DYNAMIC_PAGE_SLUGS = [
  "privacy-policy",
  "terms-of-service",
  "user-agreement",
  "risk-disclosure",
  "about-us",
  "blog",
  "contact-us",
] as const;

const LEGACY_SEEDED_DYNAMIC_PAGE_SLUG_SET = new Set<string>(
  LEGACY_SEEDED_DYNAMIC_PAGE_SLUGS,
);

const LEGACY_SUPPORT_EMAIL = "support@lonora.ai";
const LEGACY_SUPPORT_TELEGRAM = "@LonoraSupportBot";

export interface DynamicPageBrandFields {
  slug: string;
  title_ar: string;
  title_en: string;
  content_ar: string;
  content_en: string;
  metadata_json: string;
}

export interface SupportContactConfig {
  email?: string | null;
  telegram?: string | null;
}

function configured(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function buildSupportContactPage(
  contacts: SupportContactConfig,
): { contentAr: string; contentEn: string } {
  const email = configured(contacts.email);
  const telegram = configured(contacts.telegram);
  const arChannels = [
    email ? `- **البريد الإلكتروني:** ${email}` : null,
    telegram ? `- **تليجرام:** ${telegram}` : null,
  ].filter((line): line is string => Boolean(line));
  const enChannels = [
    email ? `- **Email:** ${email}` : null,
    telegram ? `- **Telegram:** ${telegram}` : null,
  ].filter((line): line is string => Boolean(line));

  if (!arChannels.length) {
    return {
      contentAr:
        "# تواصل معنا\n\nلم يضبط مشغّل المنصة وسيلة دعم عامة بعد. لا تعتمد على أي عنوان أو حساب غير معلن داخل المنصة.",
      contentEn:
        "# Contact Us\n\nNo public support channel is configured yet. Do not rely on an address or account that is not published inside the platform.",
    };
  }

  return {
    contentAr: `# تواصل معنا\n\nتواصل مع فريق الدعم عبر القنوات التي ضبطها مشغّل المنصة:\n\n${arChannels.join("\n")}`,
    contentEn: `# Contact Us\n\nContact support through the channels configured by the platform operator:\n\n${enChannels.join("\n")}`,
  };
}

function replaceLegacyContact(
  value: string,
  legacyValue: string,
  replacement: string | undefined,
): string {
  // Replace only the exact fabricated value. Keeping the surrounding text
  // intact preserves operator-authored content and keeps metadata JSON valid.
  return value.replaceAll(legacyValue, replacement ?? "");
}

function replaceLegacyBrandTokens(value: string): string {
  return value
    .replaceAll("https://www.lonora.ai/", BRAND_URL)
    .replaceAll("https://www.lonora.ai", BRAND_URL.replace(/\/$/, ""))
    .replaceAll("https://lonora.ai/", BRAND_URL)
    .replaceAll("https://lonora.ai", BRAND_URL.replace(/\/$/, ""))
    .replaceAll("www.lonora.ai", BRAND_DOMAIN)
    .replaceAll("lonora.ai", BRAND_DOMAIN)
    .replace(/\b(?:Lonora|LONORA|lonora)\b/g, BRAND_NAME);
}

function migrateLocalizedContent(
  value: string,
  contacts: SupportContactConfig,
): string {
  const email = configured(contacts.email);
  const telegram = configured(contacts.telegram);
  return replaceLegacyBrandTokens(
    replaceLegacyContact(
      replaceLegacyContact(value, LEGACY_SUPPORT_EMAIL, email),
      LEGACY_SUPPORT_TELEGRAM,
      telegram,
    ),
  );
}

/**
 * Updates only known legacy tokens inside the pages seeded by AiChart's former
 * Lonora defaults. It never replaces an entire page, and custom slugs are left
 * byte-for-byte unchanged.
 */
export function migrateLegacyDynamicPageBranding(
  page: DynamicPageBrandFields,
  contacts: SupportContactConfig,
): { changed: boolean; page: DynamicPageBrandFields } {
  if (!LEGACY_SEEDED_DYNAMIC_PAGE_SLUG_SET.has(page.slug)) {
    return { changed: false, page };
  }

  const migrated: DynamicPageBrandFields = {
    ...page,
    title_ar: replaceLegacyBrandTokens(page.title_ar),
    title_en: replaceLegacyBrandTokens(page.title_en),
    content_ar: migrateLocalizedContent(page.content_ar, contacts),
    content_en: migrateLocalizedContent(page.content_en, contacts),
    metadata_json: migrateLocalizedContent(page.metadata_json, contacts),
  };
  const changed =
    migrated.title_ar !== page.title_ar ||
    migrated.title_en !== page.title_en ||
    migrated.content_ar !== page.content_ar ||
    migrated.content_en !== page.content_en ||
    migrated.metadata_json !== page.metadata_json;
  return { changed, page: migrated };
}
