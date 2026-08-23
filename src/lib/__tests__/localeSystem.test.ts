/**
 * ONE language per account, English by default, and no silent gaps.
 *
 * The rules this locks:
 *  - the preference belongs to the ACCOUNT, so every surface (web, Telegram,
 *    MCP) resolves the same language — changing it in one place changes it
 *    everywhere, instead of each channel remembering its own;
 *  - a user who has never chosen gets English on every surface;
 *  - a MISSING translation key is a test failure, not a dotted key quietly
 *    rendered to a user;
 *  - components do not carry user-facing text; the dictionaries do.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { before, describe, it } from "node:test";

// Env FIRST — static app imports would hoist above these lines and bind the
// db module to the default dev path, so every repo module loads dynamically.
const dir = mkdtempSync(join(tmpdir(), "aichart-locale-"));
process.env.DB_PATH = join(dir, "locale.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "locale-test-secret";
delete process.env.DATABASE_URL;

let db: typeof import("@/lib/db");
let store: typeof import("@/lib/store");
let i18n: typeof import("@/lib/i18n");
let userLocale: typeof import("@/lib/i18n/userLocale");

let seq = 0;
async function makeUser(): Promise<number> {
  seq += 1;
  return db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    [`locale-${seq}@example.com`, "x", "user", "active"],
  );
}

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  store = await import("@/lib/store");
  i18n = await import("@/lib/i18n");
  userLocale = await import("@/lib/i18n/userLocale");
});

describe("the platform speaks English until told otherwise", () => {
  it("defaults to English everywhere", async () => {
    assert.equal(i18n.DEFAULT_LOCALE, "en");
    const userId = await makeUser();
    assert.equal(
      await userLocale.resolveUserLocale(userId),
      "en",
      "a user who never chose gets the platform default",
    );
  });

  it("an unknown user resolves to the default rather than throwing", async () => {
    assert.equal(await userLocale.resolveUserLocale(999_999), "en");
    assert.equal(await userLocale.resolveUserLocale(null), "en");
  });
});

describe("the choice belongs to the account, not the channel", () => {
  it("one change is visible to every surface that resolves the user", async () => {
    const userId = await makeUser();
    await store.updateSettings(userId, { language: "ar" });

    // The web session, the Telegram handler, and the MCP bridge all resolve
    // through this one function — so all three now answer in Arabic.
    assert.equal(await userLocale.resolveUserLocale(userId), "ar");

    // And back again, from any surface.
    await store.updateSettings(userId, { language: "en" });
    assert.equal(await userLocale.resolveUserLocale(userId), "en");
  });

  it("the stored value is normalized, never trusted blindly", async () => {
    const userId = await makeUser();
    await store.updateSettings(userId, { language: "klingon" });
    assert.equal(
      await userLocale.resolveUserLocale(userId),
      "en",
      "an unusable stored value falls back to the default",
    );
  });

  it("the account summary carries the language for the MCP surface", async () => {
    const userId = await makeUser();
    await store.updateSettings(userId, { language: "ar" });
    // updateSettings already seeded the account's defaults, entitlement row
    // included — insert only if this run somehow got there first.
    await db.execute(
      `INSERT INTO user_entitlements (user_id, plan_status)
       VALUES (?, 'trial')
       ON CONFLICT(user_id) DO NOTHING`,
      [userId],
    );
    const { buildAccountSummary } = await import("@/lib/billing/accountSummary");
    const summary = await buildAccountSummary({
      id: userId,
      role: "user",
      status: "active",
    });
    assert.equal(summary.language, "ar");
  });
});

describe("changing the language on the platform changes the bot too", () => {
  it("the Telegram surface renders in the language chosen on the web", async () => {
    const userId = await makeUser();
    // The web switcher writes exactly this.
    await store.updateSettings(userId, { language: "en" });

    const { formatNotificationMessage } = await import("@/lib/resident/notifications");
    const lifecycle = {
      type: "tp1_hit" as const,
      recommendationId: "rec-42",
      symbol: "XAUUSD",
      revisionNo: 1,
      dedupeKey: "k1",
      detail: "T1 reached",
      terminal: false,
      occurredAt: 1_700_000_000_000,
    };
    const english = formatNotificationMessage(
      lifecycle,
      "target",
      await userLocale.resolveUserLocale(userId),
    );

    await store.updateSettings(userId, { language: "ar" });
    const arabic = formatNotificationMessage(
      lifecycle,
      "target",
      await userLocale.resolveUserLocale(userId),
    );

    assert.notEqual(english, arabic, "the same event reads differently per language");
    assert.match(arabic, /[\u0600-\u06FF]/, "the Arabic account gets Arabic");
    assert.doesNotMatch(
      english.replace(lifecycle.detail, ""),
      /[\u0600-\u06FF]/,
      "the English account gets no Arabic chrome",
    );
  });

  it("no Telegram-facing module hardcodes a language any more", async () => {
    const { listSourceFiles } = await import("./helpers/importGraph");
    const offenders: string[] = [];
    for (const dir of ["lib/telegram", "lib/channels", "lib/agent/cards"]) {
      for (const file of listSourceFiles(path.join(process.cwd(), "src", dir))) {
        if (file.includes("__tests__")) continue;
        const source = readFileSync(file, "utf8");
        if (/\bt\(\s*"ar"\s*,/.test(source) || /locale:\s*"ar"/.test(source)) {
          offenders.push(path.relative(process.cwd(), file));
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `These bot-facing modules pin a language instead of using the account's:\n  ${offenders.join("\n  ")}`,
    );
  });
});

describe("a missing translation is never silent", () => {
  it("records every key the requested locale does not carry", () => {
    i18n.clearMissingTranslationKeys();
    i18n.t("ar", "this.key.does.not.exist");
    assert.deepEqual(i18n.missingTranslationKeys(), ["ar:this.key.does.not.exist"]);
    i18n.clearMissingTranslationKeys();
  });

  it("every key one dictionary defines, the other defines too", async () => {
    const { ar } = await import("@/lib/i18n/ar");
    const { en } = await import("@/lib/i18n/en");
    const arKeys = new Set(Object.keys(ar));
    const enKeys = new Set(Object.keys(en));
    const missingFromEn = [...arKeys].filter((k) => !enKeys.has(k));
    const missingFromAr = [...enKeys].filter((k) => !arKeys.has(k));
    assert.deepEqual(missingFromEn, [], "keys present in ar but missing from en");
    assert.deepEqual(missingFromAr, [], "keys present in en but missing from ar");
  });

  it("every literal key the code asks for exists in both dictionaries", async () => {
    const { ar } = await import("@/lib/i18n/ar");
    const { en } = await import("@/lib/i18n/en");
    const { listSourceFiles } = await import("./helpers/importGraph");
    const SRC = path.join(process.cwd(), "src");

    // Literal keys only: a computed key (`billing.refusal.${code}`) cannot be
    // resolved statically, and its family is covered by the parity check above.
    const CALL = /\bt\(\s*(?:"(?:ar|en)"|locale|DEFAULT_LOCALE)\s*,\s*"([a-zA-Z0-9_.]+)"/g;
    const missing: string[] = [];
    for (const file of listSourceFiles(SRC)) {
      if (file.includes("__tests__")) continue;
      const source = readFileSync(file, "utf8");
      for (const [, key] of source.matchAll(CALL)) {
        if (!key) continue;
        if (!(key in ar) || !(key in en)) {
          missing.push(`${path.relative(process.cwd(), file)}: ${key}`);
        }
      }
    }
    assert.deepEqual(
      missing,
      [],
      `These keys are asked for in code but absent from a dictionary — they would render as raw dotted keys:\n  ${missing.join("\n  ")}`,
    );
  });
});

describe("direction follows the language", () => {
  it("Arabic is RTL and English is LTR", () => {
    assert.equal(i18n.dirForLocale("ar"), "rtl");
    assert.equal(i18n.dirForLocale("en"), "ltr");
  });

  it("the web switcher writes the choice to the account, not just the browser", () => {
    const provider = readFileSync(
      path.join(process.cwd(), "src/components/LocaleProvider.tsx"),
      "utf8",
    );
    assert.match(provider, /\/api\/settings/, "the choice is persisted to the account");
    assert.match(provider, /language: next/, "and it is the language field that is sent");
  });
});
