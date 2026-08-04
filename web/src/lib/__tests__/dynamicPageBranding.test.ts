import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import {
  buildSupportContactPage,
  migrateLegacyDynamicPageBranding,
  type DynamicPageBrandFields,
} from "@/lib/db/dynamicPageBranding";

function page(
  overrides: Partial<DynamicPageBrandFields> = {},
): DynamicPageBrandFields {
  return {
    slug: "about-us",
    title_ar: "Lonora",
    title_en: "About Lonora",
    content_ar: "Lonora https://lonora.ai/",
    content_en: "Custom operator sentence. Lonora: https://lonora.ai/docs",
    metadata_json: JSON.stringify({
      description: "Lonora support: support@lonora.ai",
    }),
    ...overrides,
  };
}

test("fresh contact defaults never invent support channels", () => {
  const unconfigured = buildSupportContactPage({});
  assert.doesNotMatch(unconfigured.contentAr, /lonora/i);
  assert.doesNotMatch(unconfigured.contentEn, /lonora/i);
  assert.doesNotMatch(unconfigured.contentEn, /24\/7|DIFC|Dubai/i);
  assert.match(unconfigured.contentEn, /No public support channel is configured/);

  const configured = buildSupportContactPage({
    email: " help@aichart.lork.cloud ",
    telegram: " @AiChartHelp ",
  });
  assert.match(configured.contentEn, /help@aichart\.lork\.cloud/);
  assert.match(configured.contentEn, /@AiChartHelp/);
  assert.doesNotMatch(configured.contentEn, /support@lonora\.ai|LonoraSupportBot/);
});

test("known seeded pages receive token-level migration without losing custom text", () => {
  const result = migrateLegacyDynamicPageBranding(page(), {});

  assert.equal(result.changed, true);
  // BRAND_NAME is "Lonora" again (the product's original name, before the
  // AiChart era this migration function was written to clean up after) — so
  // a bare "Lonora" token is now a no-op replace, not something to strip.
  // Only the domain/contact tokens (still pointing at the legacy lonora.ai
  // literal, unrelated to the current BRAND_NAME) are expected to change.
  assert.equal(result.page.title_en, "About Lonora");
  assert.match(result.page.content_en, /^Custom operator sentence\./);
  assert.match(result.page.content_en, /https:\/\/aichart\.lork\.cloud\/docs/);
  assert.doesNotMatch(result.page.metadata_json, /support@lonora\.ai/i);
  assert.deepEqual(JSON.parse(result.page.metadata_json), {
    description: "Lonora support: ",
  });
});

test("custom dynamic-page slugs remain byte-for-byte unchanged", () => {
  const custom = page({ slug: "operator-campaign" });
  const result = migrateLegacyDynamicPageBranding(custom, {});

  assert.equal(result.changed, false);
  assert.equal(result.page, custom);
});

test("configured support contacts replace only exact fabricated legacy values", () => {
  const result = migrateLegacyDynamicPageBranding(
    page({
      slug: "contact-us",
      content_en:
        "Keep this custom escalation note.\nEmail: support@lonora.ai\nTelegram: @LonoraSupportBot",
    }),
    {
      email: "support@aichart.lork.cloud",
      telegram: "@AiChartSupport",
    },
  );

  assert.match(result.page.content_en, /^Keep this custom escalation note\./);
  assert.match(result.page.content_en, /support@aichart\.lork\.cloud/);
  assert.match(result.page.content_en, /@AiChartSupport/);
});

test("SQLite forward migration updates only known legacy page tokens", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aichart-brand-migration-"));
  const dbPath = join(dir, "legacy.db");
  process.env.DB_PATH = dbPath;
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;
  delete process.env.SUPPORT_EMAIL;
  delete process.env.SUPPORT_TELEGRAM;

  const legacyDb = new Database(dbPath);
  legacyDb.exec(`
    CREATE TABLE dynamic_pages (
      slug          TEXT PRIMARY KEY,
      title_ar      TEXT NOT NULL,
      title_en      TEXT NOT NULL,
      content_ar    TEXT NOT NULL,
      content_en    TEXT NOT NULL,
      is_published  INTEGER NOT NULL DEFAULT 1,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  const insertPage = legacyDb.prepare(`
    INSERT INTO dynamic_pages
      (slug, title_ar, title_en, content_ar, content_en, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertPage.run(
    "about-us",
    "Lonora",
    "About Lonora",
    "Lonora",
    "Keep this operator-authored paragraph. https://lonora.ai/guide",
    JSON.stringify({ description: "Lonora at https://lonora.ai/" }),
  );
  insertPage.run(
    "contact-us",
    "Contact Lonora",
    "Contact Lonora",
    "support@lonora.ai @LonoraSupportBot",
    "Keep custom escalation. support@lonora.ai @LonoraSupportBot",
    JSON.stringify({ contact: "support@lonora.ai" }),
  );
  insertPage.run(
    "operator-campaign",
    "Lonora custom",
    "Lonora custom",
    "support@lonora.ai",
    "https://lonora.ai/custom",
    JSON.stringify({ brand: "Lonora" }),
  );
  legacyDb.close();

  const db = await import("@/lib/db");
  await db.initDb();

  const about = await db.queryOne<DynamicPageBrandFields>(
    `SELECT slug, title_ar, title_en, content_ar, content_en, metadata_json
       FROM dynamic_pages
      WHERE slug = ?`,
    ["about-us"],
  );
  assert.ok(about);
  assert.equal(about.title_en, "About Lonora");
  assert.match(about.content_en, /^Keep this operator-authored paragraph\./);
  assert.match(about.content_en, /https:\/\/aichart\.lork\.cloud\/guide/);
  assert.deepEqual(JSON.parse(about.metadata_json), {
    description: "Lonora at https://aichart.lork.cloud/",
  });

  const contact = await db.queryOne<DynamicPageBrandFields>(
    `SELECT slug, title_ar, title_en, content_ar, content_en, metadata_json
       FROM dynamic_pages
      WHERE slug = ?`,
    ["contact-us"],
  );
  assert.ok(contact);
  assert.match(contact.content_en, /^Keep custom escalation\./);
  assert.doesNotMatch(
    `${contact.content_ar}\n${contact.content_en}\n${contact.metadata_json}`,
    /support@lonora\.ai|LonoraSupportBot/,
  );
  assert.doesNotThrow(() => JSON.parse(contact.metadata_json));

  const custom = await db.queryOne<DynamicPageBrandFields>(
    `SELECT slug, title_ar, title_en, content_ar, content_en, metadata_json
       FROM dynamic_pages
      WHERE slug = ?`,
    ["operator-campaign"],
  );
  assert.deepEqual(custom, page({
    slug: "operator-campaign",
    title_ar: "Lonora custom",
    title_en: "Lonora custom",
    content_ar: "support@lonora.ai",
    content_en: "https://lonora.ai/custom",
    metadata_json: JSON.stringify({ brand: "Lonora" }),
  }));
});
